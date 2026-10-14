# 01. What ReturnGuard does, end to end

## The problem

Online stores lose money to return fraud: serial refunders, wardrobing, price arbitrage, coordinated account farms, reused "evidence" photos. A human cannot review every return. ReturnGuard automates a first-pass risk score and explains it.

## The 2-minute explanation

1. A return arrives with a reason and a photo. The photo is uploaded to Blob Storage under the name `<return_id>.<ext>`.
2. Blob Storage fires a "created" event. Event Grid forwards it to a Service Bus queue.
3. A Function listening on that queue wakes up, finds the return in Postgres, and hands the metadata and the photo URL to an AI Foundry agent.
4. The agent may call a tool: "find past returns whose reason looks like this one and tell me how many were fraud." This is a vector search.
5. The agent answers `{ score, reasoning }`. The Function saves it with the OpenTelemetry trace id.
6. The dashboard shows returns sorted by score, with the reasoning and a link to the trace.

## Why the data is synthetic

Real fraud labels are rare and private. The seed scripts generate customers, orders and returns and **inject known fraud patterns**. That gives ground truth in `fraud_labels`, so the system can later be scored: how many true fraud cases did the agent rank high?

## The six archetypes and why each is detectable

| Archetype | How it is generated (`generate_returns.ts`) | What a detector should notice |
|-----------|---------------------------------------------|-------------------------------|
| serial_refunder | 4 customers with at least 4 items return 70-90% of them, 2-20 days after order | Per-customer return rate far above the norm |
| item_not_received | 4 customers, 3 claims each, reason "Item never arrived", 10-25 days after order | Repeated non-delivery claims by one person |
| return_farm | 2 clusters of 5 accounts, emails `base+N@gmail/outlook`, signup within 1 day, order within 2 days, return within 4 days | Coordinated look-alike accounts and timing |
| wardrobing | 20 apparel-like items returned 4-10 days after order | Category plus short wear window |
| price_arbitrage | 15 items, `unit_price` set to 60-75% of current price, returned 60-120 days later | Price paid below current price, late return |
| mismatched_evidence | 15 items sharing one of 3 reused photo URLs | Same photo across unrelated products |
| legit | Sized so fraud is about 15% of all returns; 40% have a unique photo | Baseline |

Important: several of these signals are **behavioral** (customer history, timing, price). The current agent only receives the return row and the image. See file 05, gap G1.

## Components in one table

| Component | Responsibility |
|-----------|----------------|
| Blob Storage + Event Grid + Service Bus | Decouple upload from scoring, buffer and retry |
| `scoreReturn` Function | Orchestrator: validate event, load data, call agent, persist |
| Foundry agent `return-fraud-scorer` (version 5) | The model plus its instructions and tool definitions |
| `find-similar-returns` HTTP Function | The agent's retrieval tool |
| PostgreSQL + pgvector | System of record plus semantic search |
| Application Insights | Traces for every scoring run |
| React dashboard | Human review surface |
| Seed scripts | Build the dataset with labels |

## What "done" looks like today

A return whose photo is uploaded gets a score and reasoning within seconds, visible in the UI with a trace link. Redis, Key Vault, App Configuration, feature flags and container deployment are not built yet (file 08).
