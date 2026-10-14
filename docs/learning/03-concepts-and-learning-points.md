# 03. Concepts and learning points

Each section: what it is, where it shows up in this repo, what to study next.

## Event-driven architecture

- **Blob Storage events via Event Grid.** Event Grid is a router: sources (Storage) publish, subscriptions deliver to handlers. Here the handler is a Service Bus queue.
- **Why a queue between Event Grid and the Function?** Buffering (spikes), retry with backoff, dead-lettering, and decoupling. Event Grid itself retries but has weaker poison-message handling.
- **At-least-once delivery.** The same message can arrive twice. Consequence in this repo: `INSERT INTO risk_scores` is not idempotent (file 05, G2). Study: idempotency keys, unique constraints plus `ON CONFLICT`.
- **Poison messages.** A message that always throws moves to the dead-letter queue after `maxDeliveryCount`. Study: how to inspect and replay a DLQ.
- **Silent drops.** Guards that `return` without throwing swallow bad input. Decide per case: drop, dead-letter explicitly, or alert.

Study next: Service Bus sessions, duplicate detection, Event Grid filters (subject prefix/suffix, so non-image blobs never reach the queue).

## Azure Functions v4 (Node)

- Code-first registration: `app.http(...)`, `app.serviceBusQueue(...)`. No `function.json`.
- `host.json` configures the host (sampling, extension bundle); `local.settings.json` holds local app settings (never deployed, gitignored).
- `authLevel`: `anonymous`, `function` (key), `admin`. Anonymous endpoints are public.
- Module-scope clients (credential, blob client, DB pool) are reused across invocations on a warm instance. Study: cold start, connection limits when the app scales out (each instance has its own pool).
- `.funcignore` controls what ships in the deployment package.
- Build output: `dist/`, entry `main: dist/src/**/*.js`.

## Managed identity and `DefaultAzureCredential`

- One credential chain: environment, managed identity, Azure CLI login, VS Code, and more. Same code works on a laptop (your login) and in Azure (managed identity).
- Used for Blob and Foundry. The database, Azure OpenAI embeddings, and Service Bus still use secrets (connection string / API key). Study: moving them to Entra auth and Key Vault references.
- Required RBAC to remember: Storage Blob Data Reader for the Function identity, Azure AI User on the Foundry project.

## AI agents and tool use

- An **agent** here is a named, versioned configuration in Foundry: model, instructions, tools. The app calls it by `agent_reference`.
- **Conversation + response** API shape: create a conversation with input items, then request a response bound to it. Items can mix text and images.
- **Tool calling.** The agent decides when to call the similarity endpoint. The tool is described with OpenAPI so the model knows its inputs. The server executes the tool over HTTP; the model never touches the database.
- **Structured output by prompt, validated in code.** The reply is parsed as JSON and checked with a type guard. Study: JSON schema constrained output (structured outputs) to remove the parse-failure class entirely.
- **Prompt as code.** The agent's instructions are part of system behavior but live outside the repo. Study: exporting the agent definition, storing it in git, deploying via CI.
- **Evaluation.** Because labels exist, you can compute precision, recall, and ROC for the score. Study: threshold selection, cost-weighted metrics (false positive on a good customer vs missed fraud).

## Embeddings and vector search

- Embedding: text becomes a 3072-float vector (`text-embedding-3-large`). Similar meaning gives nearby vectors.
- Cosine distance (`<=>`) in pgvector; `1 - distance` as similarity.
- **Sanity first.** `check_reason_archetype_correlation.ts` tests whether reason text differs by archetype before investing in embeddings. This is a good habit: validate the signal before building the infrastructure.
- Honest limitation: reasons are drawn from tiny phrase lists per archetype and overlap heavily ("Changed my mind" appears in several). Retrieval on this text mostly measures phrase overlap, not fraud. Real reasons are longer and richer.
- **Indexing.** Without an index, search is a sequential scan (fine at thousands of rows). HNSW or IVFFlat needs at most 2000 dims for `vector`; use `halfvec` (up to 4000) or shorten embeddings. Study: recall vs speed trade-offs, `ef_search`.
- **Literal formatting bug class.** Scientific notation (`1e-7`) breaks pgvector parsing; `toFixed(8)` avoids it. Note the backfill script uses plain `join(",")` (G6).

## PostgreSQL practices

- Parameterized queries everywhere (`$1`, `$2`): the SQL-injection defense.
- `COUNT(*)::int`: Postgres returns `bigint` as string in `pg`; casting avoids surprises. Same family: `NUMERIC` returns as string, hence `normalizeReturn` in the UI.
- `LEFT JOIN` with `NULLS LAST` ordering to show unscored items at the bottom.
- `TRUNCATE ... RESTART IDENTITY CASCADE` for fast idempotent reseeds.
- `ON CONFLICT (external_id) DO UPDATE` for idempotent upserts.
- `CREATE EXTENSION IF NOT EXISTS` and `ADD COLUMN IF NOT EXISTS` as poor-man's migrations. Study: real migrations (node-pg-migrate, Flyway, Drizzle Kit).
- Connection pooling: `pg.Pool` per process. Study: PgBouncer on Flexible Server when many Function instances scale out.

## Observability with OpenTelemetry

- **Trace** = one request's journey; **span** = a timed step; **attributes** = key/value context (`return.id`).
- Root span around the whole message, child span around the agent call: latency breakdown at a glance.
- Storing the trace id with the business record gives cross-linking from product data to telemetry. Excellent habit.
- `recordException` + `setStatus(ERROR)` before rethrow keeps failures visible.
- Study: auto-instrumentation for `pg` and HTTP, log correlation, custom metrics (scores histogram), KQL queries in Application Insights, sampling and its effect on stored traces (a sampled-out trace makes the UI link dead).

## Synthetic data and ground truth

- Seeded fraud patterns with labels make the project measurable.
- Realistic skew (tiered order counts) makes fraud actually stand out statistically.
- Beware **leakage**: the generator knows the answer; if the agent can see features that are artifacts of generation (for example a photo URL pattern `rg-evidence-*`), it can "cheat". Check for these.
- Beware **too-clean patterns**: real fraud is noisy and adaptive.

## Frontend patterns

- Controlled components, local `inputValue` plus debounced lift to parent: avoids a request per keystroke.
- `useEffect` fetch with dependency array; loading/error/data trio.
- Boundary normalization (`normalizeReturn`): convert wire types once, use clean types everywhere.
- Environment via `import.meta.env.VITE_*`: build-time and public.
- React Router: `Routes`, `Route`, `useParams`, `Link`.
- ESLint disables are commented with a reason, which is the right way.
- Study: TanStack Query (caching, cancellation, retries), race conditions in effect-based fetching, accessibility of the table and badges.

## TypeScript

- Type guards (`value is T`) for untrusted input: used for the agent reply.
- `strict: false` hides null bugs; enabling it is a good learning exercise (expect errors around `rows[0]`, env vars, `any`).
- Different TypeScript major versions in the two apps (7.x backend, 6.0 frontend): fine, but note it.

## Windows / tooling lessons already learned

- Prisma install failures on Windows and WSL-mounted paths led to dropping the ORM. Lesson: tooling friction is a valid reason to change the stack, but write down the trade-off (no migrations, no generated types).
- `execFileSync('npx', ..., { shell: true })` for cross-platform child processes.
