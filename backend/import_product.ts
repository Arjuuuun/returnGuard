import { pool } from './db';

interface DummyJsonProduct {
    id: number;
    title: string;
    category: string;
    price: number;
}

interface DummyJsonResponse {
    products: DummyJsonProduct[];
    total: number;
    skip: number;
    limit: number;
}

// DummyJSON paginates (30 per page by default) — loop until we've pulled everything.
async function fetchAllProducts(): Promise<DummyJsonProduct[]> {
    const limit = 10;
    let skip = 0;
    let total = Infinity;
    const all: DummyJsonProduct[] = [];

    while (skip < total) {
        const res = await fetch(`https://dummyjson.com/products?limit=${limit}&skip=${skip}`);
        if (!res.ok) throw new Error(`DummyJSON request failed: ${res.status}`);
        const data = (await res.json()) as DummyJsonResponse;
        all.push(...data.products);
        total = data.total;
        skip += limit;
    }

    return all;
}

async function importProducts() {
    const products = await fetchAllProducts();
    console.log(`Fetched ${products.length} products from DummyJSON`);

    // ON CONFLICT on external_id makes this safe to re-run — matches the seed
    // script's idempotency requirement from Task 6.
    for (const p of products) {
        await pool.query(
            `INSERT INTO products (external_id, name, category, price)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (external_id) DO UPDATE
       SET name = EXCLUDED.name,
           category = EXCLUDED.category,
           price = EXCLUDED.price`,
            [String(p.id), p.title, p.category, p.price]
        );
    }

    console.log(`Imported ${products.length} products into returnGuard.products`);
    await pool.end();
}

importProducts().catch((err) => {
    console.error('Import failed:', err);
    process.exit(1);
});