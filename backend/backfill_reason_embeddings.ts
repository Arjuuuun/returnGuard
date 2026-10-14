/**
 * backfill-reason-embeddings.ts
 *
 * One-time backfill: embeds returns.reason for every row missing an
 * embedding, using the existing Foundry deployment (text-embedding-3-large),
 * and writes the vector into returns.reason_embedding.
 *
 * Run after 001_add_reason_embedding.sql has been applied.
 * Run: npx tsx backfill-reason-embeddings.ts
 */

import { pool } from './db';
import { AzureOpenAI } from "openai";

// Reuses the same Foundry resource (AI-200-foundry-Arjun) as the scorer agent.
const endpoint = process.env.AZURE_OPENAI_ENDPOINT!; // https://ai-200-foundry-arjun.services.ai.azure.com/
const apiKey = process.env.AZURE_OPENAI_API_KEY!; // from the Foundry portal's Key field
const embeddingDeployment = process.env.AZURE_EMBEDDING_DEPLOYMENT ?? "text-embedding-3-large";
const apiVersion = "2024-10-21";

const client = new AzureOpenAI({
    endpoint,
    apiVersion,
    apiKey,
});

const BATCH_SIZE = 50; // embeddings API accepts arrays; batch to cut round trips

function toVectorLiteral(embedding: number[]): string {
    // pgvector expects e.g. '[0.1,0.2,0.3]'
    return `[${embedding.join(",")}]`;
}

async function main() {
    const { rows } = await pool.query<{ id: string; reason: string }>(
        `SELECT id, reason FROM returns WHERE reason_embedding IS NULL AND reason IS NOT NULL`
    );

    console.log(`Found ${rows.length} returns needing embeddings.`);

    let processed = 0;

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);

        const response = await client.embeddings.create({
            model: embeddingDeployment,
            input: batch.map((r) => r.reason),
        });

        // response.data is returned in the same order as input
        for (let j = 0; j < batch.length; j++) {
            const { id } = batch[j];
            const embedding = response.data[j].embedding;

            await pool.query(
                `UPDATE returns SET reason_embedding = $1::vector WHERE id = $2`,
                [toVectorLiteral(embedding), id]
            );
        }

        processed += batch.length;
        console.log(`  embedded ${processed}/${rows.length}`);
    }

    console.log("Backfill complete.");
    await pool.end();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});