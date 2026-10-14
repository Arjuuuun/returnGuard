# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

ReturnGuard: an AI-triaged e-commerce return/fraud-risk pipeline. A return (with an optional photo) lands in Blob Storage, an Event Grid → Service Bus message fires an Azure Function, which calls an Azure AI Foundry agent to score fraud risk, and the result is written back to Postgres. A `pgvector`-backed similarity search over past returns' `reason` text is exposed as a tool the agent can call mid-run.

This is a portfolio project turning Microsoft AI-200 coursework into a real, running system rather than mocks. See `README.md` for the full architecture diagram, fraud archetypes, and roadmap — read it for context before making structural changes.

**Note:** this directory is not a git repository (no `.git`). Do not assume `git log`/`git blame` are available here.

## Commands

```bash
npm run build        # tsc -> dist/
npm run watch         # tsc --watch
npm start             # prestart runs build, then `func start` (Azure Functions host)

# Data layer (run from this directory with tsx, not through npm scripts):
npx tsx seed.ts                              # idempotent: truncates all 7 tables, then
                                              # re-imports catalog, regenerates customers/
                                              # orders/returns, backfills embeddings
npx tsx verify-seed.ts                       # sanity checks + base-rate summary
npx tsx import_product.ts                    # step 1 alone: DummyJSON catalog import
npx tsx generate_customer_orders.ts          # step 2 alone: 300 customers + orders
npx tsx generate_returns.ts                  # step 3 alone: injects the 6 fraud archetypes
npx tsx backfill_reason_embeddings.ts        # step 4 alone: embeds returns.reason via Azure OpenAI
npx tsx check_reason_archetype_correlation.ts # ad hoc analysis script, not part of seed pipeline
```

There is no test suite (`npm test` is a stub) and no lint script configured.

Running the Functions host locally requires Azurite (for `AzureWebJobsStorage`) and real Azure Postgres/Foundry/Service Bus connectivity — secrets live in `local.settings.json` and `.env` (both gitignored), loaded via `dotenv` in `db.ts` and read directly via `process.env` elsewhere. There is no mock/offline mode for these external services.

## Architecture

### Two parallel entry points into the same data layer

- **Root-level `.ts` scripts** (`seed.ts`, `import_product.ts`, `generate_customer_orders.ts`, `generate_returns.ts`, `backfill_reason_embeddings.ts`, `verify-seed.ts`, `check_reason_archetype_correlation.ts`) are one-off data-generation/maintenance tools run directly via `tsx`, each opening and closing its own `pool` from `db.ts`. `seed.ts` orchestrates the others as child processes (`execFileSync('npx', ['tsx', file], ...)`) rather than importing them, specifically so each step gets its own fresh connection pool.
- **`src/functions/` and `src/services/`** are the actual Azure Functions app (compiled by `tsc` into `dist/`, run via `func start`). This is the runtime pipeline, not data seeding.

Both sides import the same `../../db` (from `src/`) / `./db` (from root) singleton `Pool`.

### The runtime pipeline (`src/`)

1. **`src/functions/scoreReturn.ts`** — Service Bus queue trigger (`return-guard-queue`). Receives an Event Grid "blob created" event, filters out non-image/too-small blobs, extracts `return_id` from the blob path (`<container>/<return_id>.<ext>`), loads the matching `returns` row, downloads the image from Blob Storage, and calls `scoreReturnWithAgent`. The result is inserted into `risk_scores`.
2. **`src/services/foundryAgent.ts`** — wraps the Azure AI Foundry agent call (`scoreReturnWithAgent`). Creates a conversation with the return metadata + image, invokes the `return-fraud-scorer` agent by name/version via `agent_reference`, and parses the agent's `output_text` as strict JSON (`{ score, reasoning }`) — throws if the agent didn't return that shape.
3. **`src/services/find_similar_return.ts`** — `findSimilarReturns(reason, k, excludeReturnId)`: embeds the given reason text (Azure OpenAI `text-embedding-3-large`), runs a pgvector cosine-distance (`<=>`) query against `returns.reason_embedding` joined to `fraud_labels`, and returns a similarity-ranked breakdown by archetype. This is meant to be called *by the agent*, not directly by application code.
4. **`src/functions/findSimilarReturnHttp.ts`** — thin HTTP wrapper (`POST /api/find-similar-returns`, anonymous auth) exposing `findSimilarReturns` as an OpenAPI tool the Foundry agent can invoke mid-run. Currently anonymous-auth for local ngrok testing only — flagged in-file as needing a real auth level before deployment.

Note the inconsistent naming convention between files (`scoreReturn.ts`, `find_similar_return.ts`, `findSimilarReturnHttp.ts`) — this is pre-existing, not something to "fix" incidentally while doing unrelated work.

### Database

7 tables (see README for full schema): `customers`, `products`, `orders`, `order_items`, `returns`, `fraud_labels`, `risk_scores`. Postgres is Azure Database for PostgreSQL Flexible Server with the `pgvector` extension. `returns.reason_embedding` is `vector(3072)` (matches `text-embedding-3-large`'s output size). There's no migration tool — schema changes are applied as ad hoc `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements (see `ensureSchema()` in `seed.ts`) rather than versioned migration files.

`fraud_labels.archetype = NULL` means confirmed legit; a non-null value is one of the six fraud archetypes described in the README.

When writing a `vector` literal for pgvector, use fixed-point formatting (`n.toFixed(8)`), not `.toString()` — very small floats serialize in scientific notation, which pgvector's input parser rejects. See `toVectorLiteral` in `find_similar_return.ts`.

### Module system note

`tsconfig.json` targets `commonjs`/`es6` with `strict: false` and `rootDir: "."` (so `dist/` mirrors both `src/` and the root scripts). Azure OpenAI access (embeddings in `find_similar_return.ts` and `backfill_reason_embeddings.ts`) goes through the `openai` SDK's `AzureOpenAI` client. Note: `openai` is present in `node_modules`/`package-lock.json` but is **missing from `package.json`'s `dependencies`** — a fresh `npm install` elsewhere won't pull it in. Worth fixing (add it to `package.json`) if you touch dependencies, but don't let it block unrelated work.
