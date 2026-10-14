/**
 * find-similar-returns.ts
 *
 * Given a new return's reason text, finds the k most similar past returns
 * (by cosine similarity over reason_embedding) and summarizes how many
 * were labeled as fraud, broken down by archetype. Called mid-run by the
 * agent as a tool (see the Foundry tool definition + orchestration wiring
 * alongside this file).
 */

import { pool } from '../../db';
import { AzureOpenAI } from "openai";

const endpoint = process.env.AZURE_OPENAI_ENDPOINT!;
const apiKey = process.env.AZURE_OPENAI_API_KEY!;
const embeddingDeployment = process.env.AZURE_EMBEDDING_DEPLOYMENT ?? "text-embedding-3-large";
const apiVersion = "2024-10-21";

const client = new AzureOpenAI({ endpoint, apiVersion, apiKey });

function toVectorLiteral(embedding: number[]): string {
    // .toString() on very small floats (e.g. 1.2e-7) uses scientific
    // notation, which pgvector's input parser rejects. toFixed forces
    // plain decimal formatting instead.
    return `[${embedding.map((n) => n.toFixed(8)).join(",")}]`;
}

export interface SimilarCase {
    return_id: string;
    reason: string;
    archetype: string | null; // null = legit
    similarity: number; // 0 to 1, higher = more similar
}

export interface SimilarCasesSummary {
    total_checked: number;
    breakdown: Record<string, number>; // e.g. { legit: 8, price_arbitrage: 2 }
    top_matches: SimilarCase[];
}

/**
 * excludeReturnId: pass the current return's own id (if it's already in
 * the table) so it doesn't match against itself.
 */
export async function findSimilarReturns(
    reason: string,
    k: number = 10,
    excludeReturnId?: string
): Promise<SimilarCasesSummary> {
    const embeddingResponse = await client.embeddings.create({
        model: embeddingDeployment,
        input: [reason],
    });
    const queryVector = toVectorLiteral(embeddingResponse.data[0].embedding);

    const { rows } = await pool.query<{
        return_id: string;
        reason: string;
        archetype: string | null;
        distance: number;
    }>(
        `SELECT
             r.id AS return_id,
             r.reason,
             fl.archetype,
             r.reason_embedding <=> $1::vector AS distance
         FROM returns r
         LEFT JOIN fraud_labels fl ON fl.return_id = r.id
         WHERE r.reason_embedding IS NOT NULL
           AND ($2::uuid IS NULL OR r.id != $2::uuid)
         ORDER BY distance ASC
         LIMIT $3`,
        [queryVector, excludeReturnId ?? null, k]
    );

    const breakdown: Record<string, number> = {};
    for (const row of rows) {
        const key = row.archetype ?? "legit";
        breakdown[key] = (breakdown[key] ?? 0) + 1;
    }

    return {
        total_checked: rows.length,
        breakdown,
        top_matches: rows.map((r) => ({
            return_id: r.return_id,
            reason: r.reason,
            archetype: r.archetype,
            similarity: 1 - r.distance, // cosine distance -> similarity
        })),
    };
}