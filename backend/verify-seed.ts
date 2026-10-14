/**
 * verify-seed.ts — Task 7 sanity checks for the ReturnGuard data layer.
 *
 * Assumes db.ts exports a `pool` (pg.Pool) the same way your other scripts
 * do — adjust the import below if your actual export name differs.
 *
 * Run with: tsx verify-seed.ts
 */
import { pool } from './db';

async function tableCounts() {
    const tables = [
        'customers',
        'products',
        'orders',
        'order_items',
        'returns',
        'fraud_labels',
        'risk_scores',
    ];

    console.log('\n=== Table row counts ===');
    const counts: Record<string, number> = {};
    for (const t of tables) {
        const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM ${t}`);
        counts[t] = rows[0].n;
        console.log(`${t.padEnd(15)} ${rows[0].n}`);
    }
    return counts;
}

async function archetypeBreakdown() {
    console.log('\n=== Fraud archetype breakdown ===');
    const { rows } = await pool.query(`
    SELECT
      COALESCE(archetype, 'legit') AS archetype,
      COUNT(*)::int AS n
    FROM fraud_labels
    GROUP BY archetype
    ORDER BY n DESC
  `);

    const total = rows.reduce((sum, r) => sum + r.n, 0);
    for (const r of rows) {
        const pct = ((r.n / total) * 100).toFixed(1);
        console.log(`${r.archetype.padEnd(20)} ${String(r.n).padEnd(6)} (${pct}%)`);
    }
    return { rows, total };
}

async function fraudLegitRatio(total: number, rows: { archetype: string; n: number }[]) {
    const legit = rows.find((r) => r.archetype === 'legit')?.n ?? 0;
    const fraud = total - legit;
    console.log('\n=== Fraud vs legit ratio ===');
    console.log(`Legit:  ${legit} (${((legit / total) * 100).toFixed(1)}%)`);
    console.log(`Fraud:  ${fraud} (${((fraud / total) * 100).toFixed(1)}%)`);
    return { legit, fraud, legitPct: (legit / total) * 100, fraudPct: (fraud / total) * 100 };
}

async function orphanChecks() {
    console.log('\n=== Referential sanity checks ===');

    const checks: { label: string; sql: string }[] = [
        {
            label: 'order_items with no matching order',
            sql: `SELECT COUNT(*)::int AS n FROM order_items oi
            LEFT JOIN orders o ON o.id = oi.order_id
            WHERE o.id IS NULL`,
        },
        {
            label: 'returns with no matching order',
            sql: `SELECT COUNT(*)::int AS n FROM returns r
            LEFT JOIN order_items oi ON oi.id = r.order_item_id
            LEFT JOIN orders o ON o.id = oi.order_id
            WHERE o.id IS NULL`,
        },
        {
            label: 'returns with no fraud_labels row',
            sql: `SELECT COUNT(*)::int AS n FROM returns r
            LEFT JOIN fraud_labels f ON f.return_id = r.id
            WHERE f.id IS NULL`,
        },
        {
            label: 'orders with zero order_items',
            sql: `SELECT COUNT(*)::int AS n FROM orders o
            LEFT JOIN order_items oi ON oi.order_id = o.id
            WHERE oi.id IS NULL`,
        },
    ];

    let anyProblem = false;
    for (const c of checks) {
        const { rows } = await pool.query(c.sql);
        const n = rows[0].n;
        if (n > 0) anyProblem = true;
        console.log(`${n === 0 ? 'OK  ' : 'WARN'}  ${c.label}: ${n}`);
    }
    if (!anyProblem) console.log('No orphaned rows found.');
}

async function spotCheckSamples() {
    console.log('\n=== Spot-check samples (2 rows per archetype) ===');

    const { rows: archetypes } = await pool.query(`
    SELECT DISTINCT COALESCE(archetype, 'legit') AS archetype FROM fraud_labels
  `);

    for (const { archetype } of archetypes) {
        console.log(`\n-- ${archetype} --`);
        const whereClause = archetype === 'legit' ? 'fl.archetype IS NULL' : 'fl.archetype = $1';
        const params = archetype === 'legit' ? [] : [archetype];

        const { rows } = await pool.query(
            `
    SELECT
      r.id          AS return_id,
      oi.order_id   AS order_id,   -- <-- get the order via order_items
      c.email,
      r.submitted_at,
      r.reason
    FROM returns r
    JOIN fraud_labels fl ON fl.return_id = r.id
    JOIN order_items oi   ON oi.id = r.order_item_id   -- new join
    JOIN orders o        ON o.id = oi.order_id
    JOIN customers c    ON c.id = o.customer_id
    WHERE ${whereClause}
    ORDER BY r.submitted_at DESC
    LIMIT 2
  `,
            params
        );

        for (const row of rows) {
            console.log(row);
        }
    }
}

async function main() {
    try {
        const counts = await tableCounts();
        const { rows, total } = await archetypeBreakdown();
        const ratio = await fraudLegitRatio(total, rows);
        await orphanChecks();
        await spotCheckSamples();

        console.log('\n=== README base-rate summary (copy into README) ===');
        console.log(`Total returns: ${total}`);
        console.log(`Legit: ${ratio.legit} (${ratio.legitPct.toFixed(1)}%)`);
        console.log(`Fraud: ${ratio.fraud} (${ratio.fraudPct.toFixed(1)}%)`);
        console.log('Archetype breakdown:');
        for (const r of rows) {
            if (r.archetype === 'legit') continue;
            console.log(`  - ${r.archetype}: ${r.n} (${((r.n / total) * 100).toFixed(1)}% of all returns)`);
        }
        console.log(`\nTable counts: ${JSON.stringify(counts, null, 2)}`);
    } catch (err) {
        console.error('verify-seed.ts failed:', err);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

main();