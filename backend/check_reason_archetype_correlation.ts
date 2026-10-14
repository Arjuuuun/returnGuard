/**
 * check-reason-archetype-correlation.ts
 *
 * Sanity check before investing in embedding storage / pgvector infra for
 * the similar-case KB tool: does `returns.reason` actually correlate with
 * `fraud_labels.archetype`, or is it noise?
 *
 * Approach: pull (reason, archetype) pairs, do simple word-frequency
 * comparison per archetype (no embeddings needed for this pass). If
 * archetypes show visibly different vocabulary distributions, reason text
 * is worth embedding. If every archetype's top terms look the same,
 * revisit the approach before building the tool.
 *
 * Run: npx tsx check-reason-archetype-correlation.ts
 */

import { pool } from './db';


const STOPWORDS = new Set([
    "the", "a", "an", "and", "or", "but", "is", "was", "it", "of", "to",
    "in", "for", "on", "with", "this", "that", "i", "my", "item", "product",
    "order", "return", "returned", "as", "be", "are", "not", "does", "did",
]);

function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

async function main() {
    const { rows } = await pool.query<{ reason: string; archetype: string | null }>(
        `SELECT r.reason, fl.archetype
     FROM returns r
     LEFT JOIN fraud_labels fl ON fl.return_id = r.id`
    );

    console.log(`Loaded ${rows.length} returns.\n`);

    // Group token counts by archetype (null = legit)
    const byArchetype = new Map<string, Map<string, number>>();
    const countsByArchetype = new Map<string, number>();

    for (const { reason, archetype } of rows) {
        const key = archetype ?? "legit";
        countsByArchetype.set(key, (countsByArchetype.get(key) ?? 0) + 1);

        if (!byArchetype.has(key)) byArchetype.set(key, new Map());
        const freq = byArchetype.get(key)!;

        for (const tok of tokenize(reason ?? "")) {
            freq.set(tok, (freq.get(tok) ?? 0) + 1);
        }
    }

    console.log("Row counts per archetype:");
    for (const [k, v] of countsByArchetype) console.log(`  ${k}: ${v}`);
    console.log("");

    // Compute a crude "distinctiveness" score per archetype: term frequency
    // in this archetype vs. term frequency across all other archetypes combined.
    const globalFreq = new Map<string, number>();
    for (const freq of byArchetype.values()) {
        for (const [tok, count] of freq) {
            globalFreq.set(tok, (globalFreq.get(tok) ?? 0) + count);
        }
    }

    for (const [archetype, freq] of byArchetype) {
        const scored = [...freq.entries()]
            .map(([tok, count]) => {
                const global = globalFreq.get(tok) ?? 1;
                // ratio of "how concentrated in this archetype" weighted by raw count
                const distinctiveness = (count / global) * Math.log(count + 1);
                return { tok, count, distinctiveness };
            })
            .filter((x) => x.count >= 3) // ignore rare noise terms
            .sort((a, b) => b.distinctiveness - a.distinctiveness)
            .slice(0, 12);

        console.log(`\n=== ${archetype} ===`);
        for (const s of scored) {
            console.log(`  ${s.tok.padEnd(20)} count=${s.count}  distinctiveness=${s.distinctiveness.toFixed(2)}`);
        }
    }

    console.log(
        "\n\nHow to read this: if archetypes share the same top terms with similar " +
        "distinctiveness scores, reason text is weakly correlated with archetype and " +
        "embeddings may not carry much signal. If each archetype has a visibly distinct " +
        "vocabulary (e.g. price_arbitrage -> 'cheaper', 'found', 'elsewhere'; " +
        "wardrobing -> 'wore', 'event', 'once'), reason text is a solid candidate for " +
        "the embedding-based KB tool."
    );

    await pool.end();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});