# ReturnGuard Backend

Azure Functions (v4 programming model, Node/TypeScript) app plus the scripts that generate the synthetic dataset.

Two independent entry points share one database layer:

| Entry point | Location | Runs via |
|-------------|----------|----------|
| Runtime pipeline (Functions app) | `src/functions`, `src/services` | `npm start` (`tsc` then `func start`) |
| Data generation and maintenance scripts | repo root `*.ts` | `npx tsx <file>` |

Both import the same `pg.Pool` from `db.ts`.

## Functions

| Function | Trigger | Purpose |
|----------|---------|---------|
| `returnGuard` (`src/functions/scoreReturn.ts`) | Service Bus queue `return-guard-queue` | Scores one return: parse blob event, load return, call agent, insert into `risk_scores` |
| `findSimilarReturns` (`src/functions/findSimilarReturnHttp.ts`) | `POST /api/find-similar-returns` | Embeds a reason text and returns the nearest past returns with fraud breakdown. Called by the Foundry agent as an OpenAPI tool |
| `getReturns` (`src/functions/getReturns.ts`) | `GET /api/returns?risk=&search=&limit=&offset=` | Paginated list for the dashboard, sorted by score descending |
| `getReturnDetail` (`src/functions/getReturnDetail.ts`) | `GET /api/returns/{id}` | One return with score, reasoning, trace id and archetype |

## Services

| File | Role |
|------|------|
| `src/services/foundryAgent.ts` | Creates a Foundry conversation (metadata + image), runs the named agent version, validates that the reply is `{ score: number, reasoning: string }` |
| `src/services/find_similar_return.ts` | Azure OpenAI embedding then pgvector cosine search (`<=>`), summarized per archetype |
| `src/services/tracing.ts` | OpenTelemetry `NodeSDK` with the Azure Monitor exporter |

## Scoring flow

```mermaid
sequenceDiagram
    participant SB as Service Bus
    participant F as scoreReturn
    participant DB as PostgreSQL
    participant AG as Foundry agent
    participant T as find-similar-returns
    SB->>F: BlobCreated event
    F->>F: skip non-image / tiny blobs, parse return_id from path
    F->>DB: SELECT return
    F->>AG: conversation(metadata + image url)
    AG->>T: tool call (reason)
    T->>DB: vector search on reason_embedding
    T-->>AG: breakdown + top matches
    AG-->>F: { score, reasoning }
    F->>DB: INSERT risk_scores (+ trace id)
```

## Database

Seven tables: `customers`, `products`, `orders`, `order_items`, `returns`, `fraud_labels`, `risk_scores`.

- `returns.reason_embedding` is `vector(3072)`, matching `text-embedding-3-large`.
- `order_items.unit_price` is the price at order time, independent of `products.price`. The price-arbitrage archetype depends on this.
- `fraud_labels.archetype IS NULL` means confirmed legit.
- There is no migration tool. `ensureSchema()` in `seed.ts` applies idempotent `ALTER TABLE ... IF NOT EXISTS` statements.

## Data scripts

```bash
npx tsx seed.ts                               # full idempotent pipeline (truncates, then runs steps 1-4)
npx tsx import_product.ts                     # 1. DummyJSON catalog (upsert on external_id)
npx tsx generate_customer_orders.ts           # 2. 300 customers, tiered order history (70/25/5)
npx tsx generate_returns.ts                   # 3. six fraud archetypes + legit baseline (~15% fraud)
npx tsx backfill_reason_embeddings.ts         # 4. embed returns.reason in batches of 50
npx tsx verify-seed.ts                        # counts, fraud ratio, orphan checks, spot checks
npx tsx check_reason_archetype_correlation.ts # ad hoc: does reason text vary by archetype?
```

`seed.ts` runs each step as a child process so every step opens and closes its own connection pool.

## Setup

```bash
npm install
npm install openai      # imported by the embedding code but missing from package.json dependencies
```

`.env` (used by `db.ts` and the scripts):

```
DATABASE_URL=postgres://user:pass@host:5432/returnGuard
AZURE_OPENAI_ENDPOINT=https://<resource>.services.ai.azure.com/
AZURE_OPENAI_API_KEY=...
AZURE_EMBEDDING_DEPLOYMENT=text-embedding-3-large
APPLICATIONINSIGHTS_CONNECTION_STRING=...
```

`local.settings.json` (used by the Functions host): `FUNCTIONS_WORKER_RUNTIME=node`, `AzureWebJobsStorage` (use Azurite locally), `ServiceBusConnection`, plus the same values as `.env` and a `Host.CORS` origin for the dashboard.

Both files are gitignored. Run Azurite, then:

```bash
npm start
```

For the agent to reach the similarity tool locally, expose the Function with a tunnel (ngrok) and register that URL as the agent's OpenAPI tool.

## Observability

`scoreReturn` opens a root span `scoreReturn.process` and a child span `foundry.agent_call`. The root span's trace id is stored in `risk_scores.reasoning_trace_id`, and the dashboard turns it into an Application Insights deep link.

## Conventions

- Parameterized SQL only; dynamic filters build `$n` placeholders (see `getReturns.ts`).
- pgvector literals use `toFixed(8)` because scientific notation is rejected by the vector parser.
- Agent output is validated with a type guard before use; malformed output throws so the message is retried.
- `strict` is off in `tsconfig.json`. Treat new code as if it were on.

## Known limitations

- Endpoints use `authLevel: anonymous` and a wildcard CORS header. Add function keys or Entra auth before any deployment.
- Blob account, Foundry endpoint and agent version are hardcoded in source; move them to configuration.
- No tests, no linter, no versioned migrations.
- Reprocessing the same message inserts a second `risk_scores` row (not idempotent).
- `risk_scores.similar_cases` is read by the detail endpoint but never written by the scorer.

See `../docs/learning/` for the full gap analysis and the roadmap.
