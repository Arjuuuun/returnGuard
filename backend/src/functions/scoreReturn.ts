import { app, InvocationContext } from "@azure/functions";
import { BlobServiceClient } from "@azure/storage-blob";
import { DefaultAzureCredential } from "@azure/identity";
import { pool } from "../../db"
import { scoreReturnWithAgent } from "../services/foundryAgent";

import '../services/tracing';
import { trace, SpanStatusCode } from '@opentelemetry/api';

const tracer = trace.getTracer('returnguard-function');

export interface BlobCreatedEvent {
    topic: string;
    subject: string;
    data: {
        api: string;
        requestId: string;
        eTag: string;
        contentType: string;
        contentLength: number;
        blobType: string;
        accessTier: string;
        url: string;
        sequencer: string;
        storageDiagnostics: {
            batchId: string;
        };
    };
    dataVersion: string;
    metadataVersion: string;
    eventType: string;
    id: string;
    eventTime: string;
}

const credential = new DefaultAzureCredential();
const blobServiceClient = new BlobServiceClient(
    "https://imagestoragearjun.blob.core.windows.net",
    credential
);

async function downloadBlob(url: string): Promise<Buffer> {
    // url looks like: https://imagestoragearjun.blob.core.windows.net/returnguard/some-image.jpg
    const urlObj = new URL(url);
    const [, containerName, ...blobPathParts] = urlObj.pathname.split("/");
    const blobName = blobPathParts.join("/");

    const containerClient = blobServiceClient.getContainerClient(containerName);
    const blobClient = containerClient.getBlobClient(blobName);

    const downloadResponse = await blobClient.download();
    const chunks: Buffer[] = [];
    for await (const chunk of downloadResponse.readableStreamBody!) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}


app.serviceBusQueue("returnGuard", {
    connection: "ServiceBusConnection",
    queueName: "return-guard-queue",
    handler: async (message: BlobCreatedEvent, context: InvocationContext) => {
        await tracer.startActiveSpan('scoreReturn.process', async (rootSpan) => {
            try {
                console.log(`Received message: ${JSON.stringify(message)}`);
                context.log("message received successfully")

                const { url, contentType, contentLength } = message.data;
                if (!contentType?.startsWith('image/')) {
                    context.warn(`Skipping non-image blob: ${url} (contentType: ${contentType})`);
                    return;
                }

                if (!contentLength || contentLength < 1000) {
                    context.warn(`Skipping suspiciously small blob: ${url} (contentLength: ${contentLength})`);
                    return;
                }
                const urlObj = new URL(url);
                const pathParts = urlObj.pathname.split("/").filter(Boolean);
                const returnId = pathParts[1]?.split(".")[0];

                if (!returnId) {
                    context.error(`Could not extract return_id from URL: ${url}`);
                    return;
                }

                rootSpan.setAttribute('return.id', returnId);

                const { rows } = await pool.query(`SELECT * from returns WHERE id = $1`, [returnId]);

                const imageBuffer = await downloadBlob(url);

                // --- child span around just the agent call ---
                const response = await tracer.startActiveSpan('foundry.agent_call', async (agentSpan) => {
                    agentSpan.setAttribute('return.id', returnId);
                    try {
                        const result = await scoreReturnWithAgent(rows[0], url);
                        agentSpan.setStatus({ code: SpanStatusCode.OK });
                        return result;
                    } catch (err) {
                        agentSpan.recordException(err as Error);
                        agentSpan.setStatus({ code: SpanStatusCode.ERROR });
                        throw err;
                    } finally {
                        agentSpan.end();
                    }
                });

                context.log("response", response)
                const { score, reasoning } = response;

                const traceId = rootSpan.spanContext().traceId;

                const { rows: updateRows } = await pool.query(
                    `INSERT INTO risk_scores (return_id, score, reasoning, reasoning_trace_id, scored_at)
                     VALUES ($1, $2, $3, $4, NOW())
                     RETURNING *`,
                    [returnId, score, reasoning, traceId]
                );
                context.log("updateRows", updateRows)

                rootSpan.setStatus({ code: SpanStatusCode.OK });
            } catch (err) {
                rootSpan.recordException(err as Error);
                rootSpan.setStatus({ code: SpanStatusCode.ERROR });
                throw err;
            } finally {
                rootSpan.end();
            }
        });
    }
})