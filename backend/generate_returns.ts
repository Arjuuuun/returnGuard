import { faker } from '@faker-js/faker';
import { pool } from './db';

// Target share of all generated returns that are fraudulent.
// Legit-return count is computed at the end to hit this ratio.
const FRAUD_SHARE = 0.15;

const SERIAL_REFUNDER_CUSTOMERS = 4;
const ITEM_NOT_RECEIVED_CUSTOMERS = 4;
const RETURN_FARM_CLUSTERS = 2;
const RETURN_FARM_CLUSTER_SIZE = 5;
const WARDROBING_COUNT = 20;
const PRICE_ARBITRAGE_COUNT = 15;
const MISMATCHED_EVIDENCE_COUNT = 15;

// Deliberately reused across multiple, unrelated products — the repetition
// itself IS the mismatched-evidence signal (same "photo" attached to a
// hoodie return and a blender return is not something a genuine photo does).
const REUSED_PHOTOS = [
    'https://picsum.photos/seed/rg-evidence-a/400',
    'https://picsum.photos/seed/rg-evidence-b/400',
    'https://picsum.photos/seed/rg-evidence-c/400',
];

const LEGIT_REASONS = [
    'Wrong size', 'Item damaged in shipping', 'No longer needed',
    'Changed my mind', 'Found a better price elsewhere', 'Item defective',
];
const WARDROBING_REASONS = ["Doesn't fit", 'Changed my mind', 'Not what I expected'];
const SERIAL_REFUNDER_REASONS = ['Changed my mind', 'Not as described', 'No longer needed'];
const RETURN_FARM_REASONS = ['Wrong item received', 'Not as described', 'Changed my mind'];
const PRICE_ARBITRAGE_REASONS = ['No longer needed', 'Ordered by mistake', 'Found cheaper elsewhere'];
const MISMATCHED_EVIDENCE_REASONS = ['Item damaged in shipping', 'Wrong item received', 'Not as described'];

type OrderItemRow = {
    order_item_id: string;
    product_id: string;
    unit_price: string;
    customer_id: string;
    ordered_at: Date;
    category: string;
    current_price: string;
};

const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000);

async function insertReturn(
    client: any,
    orderItemId: string,
    reason: string,
    photoUrl: string | null,
    submittedAt: Date,
    archetype: string | null
) {
    const res = await client.query(
        `INSERT INTO returns (order_item_id, reason, photo_url, submitted_at)
     VALUES ($1, $2, $3, $4) RETURNING id`,
        [orderItemId, reason, photoUrl, submittedAt]
    );
    const returnId = res.rows[0].id;
    await client.query(
        `INSERT INTO fraud_labels (return_id, archetype) VALUES ($1, $2)`,
        [returnId, archetype]
    );
}

async function main() {
    const client = await pool.connect();
    let fraudCount = 0;

    try {
        const { rows } = await client.query<OrderItemRow>(`
      SELECT oi.id AS order_item_id, oi.product_id, oi.unit_price,
             o.customer_id, o.ordered_at,
             p.category, p.price AS current_price
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      JOIN products p ON p.id = oi.product_id
    `);

        const used = new Set<string>();
        const byCustomer = new Map<string, OrderItemRow[]>();
        for (const row of rows) {
            if (!byCustomer.has(row.customer_id)) byCustomer.set(row.customer_id, []);
            byCustomer.get(row.customer_id)!.push(row);
        }

        // ── Archetype 1: serial refunder ──────────────────────────
        // Pick customers with enough order history, return most of their items.
        // The tell isn't any single return — it's the abnormal RATE for one customer.
        const eligibleForSerial = [...byCustomer.entries()].filter(([, items]) => items.length >= 4);
        const serialCustomers = faker.helpers.arrayElements(eligibleForSerial, SERIAL_REFUNDER_CUSTOMERS);
        for (const [, items] of serialCustomers) {
            const returnShare = faker.number.float({ min: 0.7, max: 0.9 });
            const toReturn = faker.helpers.arrayElements(items, Math.ceil(items.length * returnShare));
            for (const item of toReturn) {
                if (used.has(item.order_item_id)) continue;
                used.add(item.order_item_id);
                await insertReturn(
                    client, item.order_item_id,
                    faker.helpers.arrayElement(SERIAL_REFUNDER_REASONS),
                    null,
                    addDays(item.ordered_at, faker.number.int({ min: 2, max: 20 })),
                    'serial_refunder'
                );
                fraudCount++;
            }
        }

        // ── Archetype 2: item-not-received abuse ──────────────────
        // Same customer repeatedly claims non-delivery — one claim is normal,
        // three from one person across different orders is the pattern.
        const remainingCustomers = [...byCustomer.entries()].filter(
            ([id, items]) => items.length >= 3 && !serialCustomers.some(([sid]) => sid === id)
        );
        const inrCustomers = faker.helpers.arrayElements(remainingCustomers, ITEM_NOT_RECEIVED_CUSTOMERS);
        for (const [, items] of inrCustomers) {
            const claims = faker.helpers.arrayElements(items, Math.min(3, items.length));
            for (const item of claims) {
                if (used.has(item.order_item_id)) continue;
                used.add(item.order_item_id);
                await insertReturn(
                    client, item.order_item_id, 'Item never arrived', null,
                    addDays(item.ordered_at, faker.number.int({ min: 10, max: 25 })),
                    'item_not_received'
                );
                fraudCount++;
            }
        }

        // ── Archetype 3: return farm ──────────────────────────────
        // Fresh cluster of accounts with suspiciously similar emails and tightly
        // clustered signup/order/return timing — coordinated abuse, not one bad actor.
        const { rows: farmProducts } = await client.query('SELECT id, price FROM products LIMIT 50');
        for (let c = 0; c < RETURN_FARM_CLUSTERS; c++) {
            const baseName = faker.internet.username().toLowerCase();
            const clusterSignupDay = faker.date.recent({ days: 60 });
            for (let m = 0; m < RETURN_FARM_CLUSTER_SIZE; m++) {
                const email = `${baseName}+${m}@${faker.helpers.arrayElement(['gmail.com', 'outlook.com'])}`;
                const signupDate = addDays(clusterSignupDay, faker.number.int({ min: 0, max: 1 }));
                const custRes = await client.query(
                    `INSERT INTO customers (name, email, signup_date) VALUES ($1, $2, $3) RETURNING id`,
                    [faker.person.fullName(), email, signupDate]
                );
                const customerId = custRes.rows[0].id;

                const orderedAt = addDays(signupDate, faker.number.int({ min: 0, max: 2 }));
                const orderRes = await client.query(
                    `INSERT INTO orders (customer_id, ordered_at, status) VALUES ($1, $2, 'completed') RETURNING id`,
                    [customerId, orderedAt]
                );
                const orderId = orderRes.rows[0].id;

                const product = faker.helpers.arrayElement(farmProducts);
                const itemRes = await client.query(
                    `INSERT INTO order_items (order_id, product_id, quantity, unit_price)
           VALUES ($1, $2, 1, $3) RETURNING id`,
                    [orderId, product.id, product.price]
                );
                const orderItemId = itemRes.rows[0].id;

                await insertReturn(
                    client, orderItemId,
                    faker.helpers.arrayElement(RETURN_FARM_REASONS),
                    null,
                    addDays(orderedAt, faker.number.int({ min: 1, max: 4 })),
                    'return_farm'
                );
                fraudCount++;
            }
        }

        // ── Archetype 4: wardrobing ────────────────────────────────
        // Apparel-category items, returned quickly (worn-then-returned window).
        const apparelPool = rows.filter(
            (r) => !used.has(r.order_item_id) && /shirt|dress|shoe|top|jewellery|watch|bag/i.test(r.category)
        );
        const wardrobingItems = faker.helpers.arrayElements(
            apparelPool, Math.min(WARDROBING_COUNT, apparelPool.length)
        );
        for (const item of wardrobingItems) {
            used.add(item.order_item_id);
            await insertReturn(
                client, item.order_item_id,
                faker.helpers.arrayElement(WARDROBING_REASONS),
                null,
                addDays(item.ordered_at, faker.number.int({ min: 4, max: 10 })),
                'wardrobing'
            );
            fraudCount++;
        }

        // ── Archetype 5: price-arbitrage return ────────────────────
        // Simulate "bought cheap, returning after price rose": push unit_price
        // down relative to the product's current price, then return LATE
        // (long delay is part of the tell — legit returns happen faster).
        const arbitragePool = rows.filter((r) => !used.has(r.order_item_id));
        const arbitrageItems = faker.helpers.arrayElements(
            arbitragePool, Math.min(PRICE_ARBITRAGE_COUNT, arbitragePool.length)
        );
        for (const item of arbitrageItems) {
            used.add(item.order_item_id);
            const discountedPrice = (Number(item.current_price) * faker.number.float({ min: 0.6, max: 0.75 })).toFixed(2);
            await client.query(`UPDATE order_items SET unit_price = $1 WHERE id = $2`, [discountedPrice, item.order_item_id]);
            await insertReturn(
                client, item.order_item_id,
                faker.helpers.arrayElement(PRICE_ARBITRAGE_REASONS),
                null,
                addDays(item.ordered_at, faker.number.int({ min: 60, max: 120 })),
                'price_arbitrage'
            );
            fraudCount++;
        }

        // ── Archetype 6: mismatched evidence ───────────────────────
        // Same handful of "photos" reused across unrelated products/returns.
        const mismatchPool = rows.filter((r) => !used.has(r.order_item_id));
        const mismatchItems = faker.helpers.arrayElements(
            mismatchPool, Math.min(MISMATCHED_EVIDENCE_COUNT, mismatchPool.length)
        );
        for (const item of mismatchItems) {
            used.add(item.order_item_id);
            await insertReturn(
                client, item.order_item_id,
                faker.helpers.arrayElement(MISMATCHED_EVIDENCE_REASONS),
                faker.helpers.arrayElement(REUSED_PHOTOS),
                addDays(item.ordered_at, faker.number.int({ min: 3, max: 15 })),
                'mismatched_evidence'
            );
            fraudCount++;
        }

        console.log(`Fraud returns generated: ${fraudCount}`);

        // ── Legit population, sized to hit ~FRAUD_SHARE of all returns ──
        const legitPool = rows.filter((r) => !used.has(r.order_item_id));
        const legitTarget = Math.round((fraudCount / FRAUD_SHARE) * (1 - FRAUD_SHARE));
        const legitItems = faker.helpers.arrayElements(legitPool, Math.min(legitTarget, legitPool.length));
        for (const item of legitItems) {
            const hasPhoto = faker.datatype.boolean(0.4);
            await insertReturn(
                client, item.order_item_id,
                faker.helpers.arrayElement(LEGIT_REASONS),
                hasPhoto ? `https://picsum.photos/seed/rg-legit-${item.order_item_id}/400` : null,
                addDays(item.ordered_at, faker.number.int({ min: 1, max: 30 })),
                null // archetype = null → confirmed legit, ground truth for the negative class
            );
        }

        console.log(`Legit returns generated: ${legitItems.length}`);
        console.log(`Total returns: ${fraudCount + legitItems.length} (fraud share: ${(
            (fraudCount / (fraudCount + legitItems.length)) * 100
        ).toFixed(1)}%)`);
    } finally {
        client.release();
        await pool.end();
    }
}

main().catch((err) => {
    console.error('Generation failed:', err);
    process.exit(1);
});