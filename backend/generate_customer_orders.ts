import { faker } from '@faker-js/faker';
import { pool } from './db';

const CUSTOMER_COUNT = 300;

// Activity tiers give the population a realistic skew: most customers order
// rarely, a smaller tail orders a lot. This matters later — serial refunders
// and return farms (Task 5) are supposed to look statistically abnormal
// against this baseline, not just carry a hardcoded label.
type Tier = { weight: number; minOrders: number; maxOrders: number };
const TIERS: Tier[] = [
    { weight: 0.70, minOrders: 1, maxOrders: 3 },   // typical customer
    { weight: 0.25, minOrders: 4, maxOrders: 8 },   // frequent shopper
    { weight: 0.05, minOrders: 9, maxOrders: 20 },  // high-volume tail
];

function pickTier(): Tier {
    const r = Math.random();
    let cumulative = 0;
    for (const tier of TIERS) {
        cumulative += tier.weight;
        if (r <= cumulative) return tier;
    }
    return TIERS[TIERS.length - 1];
}

async function getAllProducts(): Promise<{ id: string; price: string }[]> {
    const res = await pool.query('SELECT id, price FROM products');
    return res.rows;
}

async function generate() {
    const products = await getAllProducts();
    if (products.length === 0) {
        throw new Error('No products found — run import-products.ts first.');
    }

    const client = await pool.connect();
    try {
        for (let i = 0; i < CUSTOMER_COUNT; i++) {
            const name = faker.person.fullName();
            const email = faker.internet
                .email({ firstName: name.split(' ')[0] })
                .toLowerCase();
            const signupDate = faker.date.past({ years: 2 });

            const custRes = await client.query(
                `INSERT INTO customers (name, email, signup_date) VALUES ($1, $2, $3) RETURNING id`,
                [name, email, signupDate]
            );
            const customerId = custRes.rows[0].id;

            const tier = pickTier();
            const orderCount = faker.number.int({ min: tier.minOrders, max: tier.maxOrders });

            for (let o = 0; o < orderCount; o++) {
                const orderedAt = faker.date.between({ from: signupDate, to: new Date() });
                const orderRes = await client.query(
                    `INSERT INTO orders (customer_id, ordered_at, status) VALUES ($1, $2, 'completed') RETURNING id`,
                    [customerId, orderedAt]
                );
                const orderId = orderRes.rows[0].id;

                const itemCount = faker.number.int({ min: 1, max: 4 });
                for (let it = 0; it < itemCount; it++) {
                    const product = faker.helpers.arrayElement(products);
                    const quantity = faker.number.int({ min: 1, max: 3 });
                    // unit_price captures price AT TIME OF ORDER, independent of
                    // products.price today — this is what Task 5's price-arbitrage
                    // archetype will exploit (order low, return after price rose).
                    await client.query(
                        `INSERT INTO order_items (order_id, product_id, quantity, unit_price)
             VALUES ($1, $2, $3, $4)`,
                        [orderId, product.id, quantity, product.price]
                    );
                }
            }

            if ((i + 1) % 50 === 0) {
                console.log(`  ...${i + 1}/${CUSTOMER_COUNT} customers done`);
            }
        }

        console.log(`Generated ${CUSTOMER_COUNT} customers with tiered order history.`);
    } finally {
        client.release();
        await pool.end();
    }
}

generate().catch((err) => {
    console.error('Generation failed:', err);
    process.exit(1);
});