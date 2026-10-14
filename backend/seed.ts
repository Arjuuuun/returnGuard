import { pool } from './db';
import { execFileSync } from 'child_process';

// Order matters for CASCADE to clean up dependents, but CASCADE handles it
// regardless of the order listed here — kept in FK-dependency order for readability.
const TABLES = [
    'fraud_labels',
    'risk_scores',
    'returns',
    'order_items',
    'orders',
    'customers',
    'products',
];

async function resetTables() {
    console.log('Truncating all tables (clean slate)...');
    await pool.query(`TRUNCATE TABLE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
    console.log('Tables truncated.\n');
}

async function ensureSchema() {
    console.log('Ensuring schema (reason_embedding column)...');
    await pool.query(`CREATE EXTENSION IF NOT EXISTS vector;`);
    await pool.query(`
        ALTER TABLE returns
          ADD COLUMN IF NOT EXISTS reason_embedding vector(3072);
    `);
    await pool.query(`
        ALTER TABLE risk_scores
          ADD COLUMN IF NOT EXISTS reasoning text;
    `);
    await pool.query(`
        ALTER TABLE risk_scores
          ADD COLUMN IF NOT EXISTS similar_cases jsonb;
    `);
    console.log('Schema ready.\n');
}

function runStep(label: string, file: string) {
    console.log(`=== ${label} ===`);
    // shell: true so this works cross-platform (Windows resolves npx via npx.cmd)
    execFileSync('npx', ['tsx', file], { stdio: 'inherit', shell: true });
    console.log(`=== ${label} done ===\n`);
}

async function main() {
    await ensureSchema();
    await resetTables();
    // Release this pool before spawning child processes — each script below
    // opens and closes its own pool via db.ts, so we don't want two live
    // pools pointed at the same server from this one orchestrator process.
    await pool.end();

    runStep('Step 1: Import products', 'import_product.ts');
    runStep('Step 2: Generate customers & orders', 'generate_customer_orders.ts');
    runStep('Step 3: Generate returns & fraud labels', 'generate_returns.ts');
    runStep('Step 4: Backfill reason embeddings', 'backfill_reason_embeddings.ts');

    console.log('Seed complete — all 7 tables populated, embeddings backfilled.');
}

main().catch((err) => {
    console.error('Seed orchestration failed:', err);
    process.exit(1);
});