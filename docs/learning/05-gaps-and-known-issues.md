# 05. Gaps and known issues

Severity: **H** breaks correctness or security, **M** quality/robustness, **L** polish. Effort: S under 1h, M half day, L multi-day.

## Product / ML gaps

| ID | Sev | Gap | Why it matters | Fix idea | Effort |
|----|-----|-----|---------------|----------|--------|
| G1 | H | Agent only sees the return row and the photo, not customer history, order timing, price delta, or account cluster | Five of six archetypes are behavioral; the model cannot see the signals that define them | Add a "customer risk profile" step: SQL aggregates (return rate, claim count, price delta, account age, email-similarity cluster) passed to the agent, or exposed as a second tool | M-L |
| G3 | M | No evaluation harness | Ground truth exists but nothing computes precision/recall | Script: score a labeled sample, compute metrics by archetype and threshold | M |
| G7 | M | Agent instructions/tool schema live only in Foundry portal | Not reproducible or reviewable | Export to repo, deploy by script, pin version via config | M |
| G11 | M | Reason text is low-information (tiny phrase lists, shared across archetypes) | Similar-case search mostly returns phrase matches; breakdown is weak evidence | Enrich synthetic text (LLM-generated reasons with archetype-flavored detail) and re-run the correlation check | M |
| G12 | L | Label leakage risk: `rg-evidence-*` photo URLs and `archetype` exposed in API | Agent or UI could rely on artifacts | Hide `archetype` from production views; audit features | S |

## Backend correctness

| ID | Sev | Gap | Location | Fix | Effort |
|----|-----|-----|----------|-----|--------|
| G2 | H | Non-idempotent insert: redelivery or retry after a late failure adds duplicate `risk_scores` rows | `scoreReturn.ts` INSERT | Unique index on `(return_id, agent_version)` or on `return_id`; `ON CONFLICT DO UPDATE` | S |
| G4 | M | `downloadBlob` result unused; costs a download per message; agent fetches via URL (needs the blob to be reachable by Foundry, e.g. SAS/public) | `scoreReturn.ts` | Either remove the download, or pass the bytes as base64 / generate a short-lived SAS URL | S |
| G5 | M | `LEFT JOIN risk_scores` multiplies rows if a return has several scores; pagination then shows duplicates | `getReturns.ts`, `getReturnDetail.ts` | `DISTINCT ON (r.id)` ordered by `scored_at DESC`, or a latest-score view | S |
| G6 | M | Backfill uses `embedding.join(",")` while query path uses `toFixed(8)`; scientific notation can be rejected | `backfill_reason_embeddings.ts` `toVectorLiteral` | Share one helper module | S |
| G8 | M | `rows[0]` undefined when return id unknown; later property access throws a confusing error and retries to dead-letter | `scoreReturn.ts` | Check and log a clear error, dead-letter explicitly | S |
| G9 | M | No vector index; 3072 dims exceeds the 2000 limit for `vector` HNSW/IVFFlat | schema | Use `halfvec(3072)` + HNSW or truncate dimensions | M |
| G13 | M | `similar_cases` is read in detail API but never written | `scoreReturn.ts`, `getReturnDetail.ts` | Capture tool results (see file 06, recipe 1) | M |
| G14 | M | `limit`/`offset` unvalidated | `getReturns.ts` | Parse, clamp (1-100), default | S |
| G15 | M | `search` uses `r.id::text ILIKE '%...%'`: leading wildcard forces a scan and no wildcard escaping (`%`, `_`) | `getReturns.ts` | Prefix match on text or exact uuid; escape wildcards | S |
| G16 | M | No total count; UI cannot paginate | `getReturns.ts` | Add `total` or cursor pagination | S |
| G17 | L | `risk=high` is the only filter; sorting is fixed | `getReturns.ts` | Add `min_score`, `archetype`, `sort` whitelist | S |
| G18 | L | Pool is never closed in Functions (fine) but has no size/timeout config | `db.ts` | Set `max`, `idleTimeoutMillis`, `connectionTimeoutMillis` | S |

## Security

| ID | Sev | Gap | Fix |
|----|-----|-----|-----|
| S1 | H | HTTP functions are `anonymous`; the tool endpoint is a public embedding-cost endpoint (each call spends Azure OpenAI tokens) | `function` keys or Entra auth; APIM in front; rate limit |
| S2 | H | Wildcard CORS header set manually in two functions | Central CORS via host config with explicit origin list |
| S3 | H | `rejectUnauthorized: false` on Postgres | Verify server cert |
| S4 | M | Secrets in `.env` / `local.settings.json` (gitignored, but plain files on disk, folder not yet in git) | Key Vault; make sure a root `.gitignore` exists before the first commit |
| S5 | M | Tool endpoint accepts arbitrary `k` | Cap `k` (for example 25) and reason length |
| S6 | M | Prompt injection: return `reason` text is passed to the agent as data; a malicious reason can try to steer the score | Delimit untrusted text, instruct the agent to treat it as data, bound score by rules, log anomalies |
| S7 | L | `helmet` is a dependency but unused (it is an Express middleware, not relevant to Functions) | Remove |

## Reliability and operations

| ID | Sev | Gap | Fix |
|----|-----|-----|-----|
| R1 | M | No dead-letter handling/alerting | Alert on DLQ depth; replay tooling |
| R2 | M | No timeout/retry policy around the agent call | Timeout, bounded retries with backoff, circuit-breaker idea |
| R3 | M | Silent skips (non-image/tiny blob) | Event Grid subject filter so they never enqueue; or log metric |
| R4 | M | Sampling may drop the trace behind a stored trace id | Always-sample scoring spans, or store a correlation id and query by custom dimension |
| R5 | L | No health/readiness endpoint | Add `GET /api/health` that checks DB |
| R6 | L | Scoring latency/score distribution not measured | Custom metrics |

## Frontend

| ID | Sev | Gap | Fix |
|----|-----|-----|-----|
| F1 | M | Effect-based fetching has no cancellation: slow earlier response can overwrite a newer one (race) | `AbortController` or TanStack Query |
| F2 | M | No pagination UI although API supports it | Pager or infinite scroll, needs total (G16) |
| F3 | M | Detail page ignores `similar_cases` (API returns it) | Render once G13 is done |
| F4 | L | Thresholds 0.7/0.4 duplicated in `ReturnsList` and `ReturnDetail` (and 0.7 in backend) | Shared `risk.ts`; backend returns a `risk_level` |
| F5 | L | No auto-refresh while returns are pending | Poll or SSE/SignalR (file 07) |
| F6 | L | Unscored returns show as "Pending" sorted last, and `risk=high` hides them, so a stuck/unscored return is invisible in that view | Add a "Pending" filter and an age indicator |
| F7 | L | Accessibility: color-only badges, table without caption | Text already present in badge; add caption/aria |
| F8 | L | `.env` holds portal ids needed to build trace link; fine but public in bundle | Acceptable (not secret); alternatively backend returns the full trace URL |
| F9 | L | Raw `Error: fetchReturns failed: 500` shown to users | Friendly messages and retry button |

## Build / repo hygiene

| ID | Sev | Gap | Fix |
|----|-----|-----|-----|
| B1 | H | `openai` missing from `backend/package.json` | `npm install openai` |
| B2 | M | No git repository, no root `.gitignore` | `git init`, add root ignore (node_modules, dist, .env, local.settings.json, azurite files) before first commit |
| B3 | M | `schema.sql` referenced by old docs but absent | Export current schema (`pg_dump --schema-only`) into `backend/db/schema.sql` |
| B4 | L | `tsconfig` `include: src/**` but root scripts depend on `rootDir: "."` | Separate `tsconfig.scripts.json` |
| B5 | L | `package.json` `main` and metadata are empty/default | Fill description, set `private: true` |
| B6 | L | Mixed file naming | Dedicated rename commit |
| B7 | L | `azurite-debug.log`, `azurite-data/` present in folder | Ensure ignored |

## Suggested order of attack

1. B1, B2, B3 (hygiene, 30 minutes).
2. G2, G8, G14 (small correctness).
3. S1-S3 (security before any deployment).
4. G13 + F3 (visible feature, uses real tool output).
5. G1 (biggest lift in model quality).
6. G3 (prove it works with numbers).
7. G9, F1, F2, R1-R4.
