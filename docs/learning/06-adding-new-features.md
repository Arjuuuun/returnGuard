# 06. How to add new features

## Extension points (where things plug in)

| You want to add... | Plug in at | Touches |
|--------------------|-----------|---------|
| A new HTTP endpoint | New file in `src/functions/` with `app.http(...)` | Optionally a service, frontend `api.ts` |
| A new async step | New `serviceBusQueue` / `eventGrid` / `timer` function | Queue, config |
| A new agent tool | New HTTP function + OpenAPI spec registered on the agent | Agent version bump, `foundryAgent.ts` version constant |
| A new risk signal | SQL in a service + include in agent input (or tool) | `foundryAgent.ts`, prompt |
| A new table/column | `ensureSchema` now; migration file later | Seed scripts, APIs, types |
| A new fraud archetype | `generate_returns.ts` block + constants | `verify-seed.ts` (auto), README table |
| A new UI page | Route in `App.tsx`, component, `api.ts` function | Backend endpoint |

Rule: Functions are registered by importing the file. Anything under `src/functions/` compiled into `dist/src/functions` is auto-discovered through `main: dist/src/**/*.js`.

---

## Recipe 1: Persist and show similar cases (closes G13, F3)

Goal: the detail page shows which past returns the agent compared against.

1. **Decide the source of truth.** The agent calls the tool, so the Function does not see the result. Two options:
   - (a) Log tool calls server-side: in `findSimilarReturnHttp.ts`, write the request and result into a new table `agent_tool_calls(return_id, tool, args jsonb, result jsonb, created_at)`. The tool already receives `return_id`.
   - (b) Re-run `findSimilarReturns(reason, 10, returnId)` in `scoreReturn.ts` after scoring and store it in `risk_scores.similar_cases`. Simpler, but may differ slightly from what the agent saw.
2. Start with (b): after the agent call, call `findSimilarReturns` and add `similar_cases` to the INSERT.
3. `getReturnDetail` already returns `similar_cases`.
4. Frontend: add a `SimilarCases` component to `ReturnDetail.tsx` (table: reason, archetype, similarity). Type `similar_cases` properly in `types.ts` instead of `unknown`.
5. Test: insert a return, score it, confirm JSON in DB, confirm UI.

## Recipe 2: Customer risk profile as agent input (closes G1)

Goal: give the agent behavioral features.

1. New service `src/services/customerProfile.ts`:
   ```sql
   -- per customer
   SELECT c.id, c.signup_date,
          COUNT(DISTINCT oi.id)                 AS items_ordered,
          COUNT(DISTINCT r.id)                  AS items_returned,
          COUNT(*) FILTER (WHERE r.reason = 'Item never arrived') AS inr_claims,
          AVG(r.submitted_at - o.ordered_at)    AS avg_return_delay
   FROM customers c
   JOIN orders o ON o.customer_id = c.id
   JOIN order_items oi ON oi.order_id = o.id
   LEFT JOIN returns r ON r.order_item_id = oi.id
   WHERE c.id = $1
   GROUP BY c.id;
   ```
   Plus: price delta (`oi.unit_price` vs `products.price`), days since order, category, email-similarity cluster size (`split_part(email,'+',1)` match, or trigram `pg_trgm` similarity).
2. In `scoreReturn.ts`, fetch the profile and pass `{ return, profile }` to `scoreReturnWithAgent` (extend its parameter).
3. Update agent instructions to explain each feature and expected ranges; publish a new agent version; bump `agentVersion`.
4. Cache the profile in Redis (Recipe 5) since it is read-heavy and changes slowly.
5. Evaluate before and after with the harness (Recipe 3). This is the experiment that proves the feature helped.

## Recipe 3: Evaluation harness (closes G3)

1. Script `evaluate.ts` (root, run with tsx).
2. Sample N labeled returns (stratified by archetype). For each, ensure a score exists or call `scoreReturnWithAgent`.
3. Binary truth = `archetype IS NOT NULL`. Prediction = `score > threshold`.
4. Output: confusion matrix, precision, recall, F1 at several thresholds, recall per archetype, ROC-AUC (rank-based).
5. Save results with agent version and date into table `eval_runs`. Display later on a dashboard page.
6. Watch for cost: each scoring run is an agent call.

## Recipe 4: Real-time dashboard updates

Options, increasing effort:
1. **Polling**: `setInterval` refetch every 5 s while any row is Pending. Cheapest, fine now.
2. **Server-Sent Events** from a Function: needs a long-lived connection; awkward on Consumption plan.
3. **Azure SignalR Service** with the Functions binding: Function pushes "scored" event after the INSERT; the SPA subscribes. Best fit; needs a negotiate endpoint and the `@microsoft/signalr` client.
4. Postgres `LISTEN/NOTIFY` is not suitable for serverless fan-out.

## Recipe 5: Redis per-customer risk cache (planned in original design)

1. Provision Azure Cache for Redis (or Azure Managed Redis); connect with Entra auth.
2. `src/services/cache.ts`: `getOrCompute(key, ttl, fn)`.
3. Key `risk:customer:{id}`, TTL a few minutes; invalidate on a new return for that customer.
4. Use for the customer profile (Recipe 2) and for list endpoint aggregates.
5. Pitfalls: stampedes (add jitter, single-flight), stale scores (short TTL), serialization.

## Recipe 6: Manual review workflow

1. Table `reviews(return_id, reviewer, decision, notes, decided_at)`; decision enum: approve, reject, escalate.
2. Endpoints `POST /api/returns/{id}/review`, include latest review in list/detail.
3. UI: buttons on the detail page, status column, filter "Needs review" (score above threshold and no review).
4. This also produces **real labels** to compare against the agent, the seed of a feedback loop (Recipe 8).
5. Needs auth (who is the reviewer?): see Recipe 7.

## Recipe 7: Authentication and authorization

1. Dashboard users: Entra ID with MSAL (`@azure/msal-react`), SPA gets an access token.
2. API: App Service Authentication ("Easy Auth") on the Function App, or validate JWT in code.
3. Roles: `Reviewer`, `Admin` via app roles; check in functions.
4. Agent tool endpoint: separate protection (function key or managed identity from Foundry), not user tokens.
5. CORS: explicit origin only.

## Recipe 8: Feedback loop and drift monitoring

1. Store reviewer decisions (Recipe 6) as ground truth.
2. Weekly job (timer trigger) compares scores to decisions, writes metrics.
3. Alert when precision at the operating threshold drops or the score distribution shifts (population stability index).
4. Use disagreements as new few-shot examples or retrieval content (the similar-case table can include reviewed real cases).

## Recipe 9: Feature flags and A/B model switching (planned stretch)

1. Azure App Configuration with a feature flag `agent-version` (or variant flags).
2. In `foundryAgent.ts`, read name/version from config at runtime with a Sentinel-key refresh.
3. Log the version on the span and in `risk_scores.agent_version` (new column).
4. Route a percentage of returns to version B; compare with the evaluation harness.

## Recipe 10: Secrets and config hardening

1. Key Vault for `DATABASE_URL`, `AZURE_OPENAI_API_KEY`; Function App settings use `@Microsoft.KeyVault(SecretUri=...)` references.
2. A `config.ts` that reads and validates env once (fail fast).
3. Remove hardcoded blob account and Foundry endpoint.
4. Use Entra auth to Postgres and Azure OpenAI to eliminate keys.

## Recipe 11: Deployment

1. Functions: either Flex Consumption/Premium via `func azure functionapp publish`, or a container image on Azure Container Apps (Functions-on-ACA).
2. Dashboard: Azure Static Web Apps (built-in auth and API proxy) or a container.
3. GitHub Actions: build, lint, test, deploy; OIDC federated credential to Azure (no stored secrets).
4. Infra as code: Bicep or Terraform for every resource (Storage, Event Grid subscription, Service Bus, Postgres, Foundry, App Insights).
5. Environments: dev and prod separated by resource group; separate agent versions.

## Recipe 12: Photo analysis improvements

1. Perceptual hashing (pHash) of each uploaded image; store in `returns.image_phash`; look for near-duplicates across returns (directly detects mismatched_evidence).
2. Image embeddings (multimodal) in a second vector column.
3. EXIF checks (capture date vs order date).
4. Expose "find duplicate images" as another agent tool.

## Recipe 13: A new fraud archetype (worked example: "empty box")

1. In `generate_returns.ts`: add constants, a reason list, a block that picks N items, sets reason "Box was empty", return within 1-3 days, `archetype = 'empty_box'`, adds to `used`.
2. Add a distinguishing feature that is detectable (for example high-value electronics, repeated by a customer with a new address).
3. Reseed, run `verify-seed.ts` (breakdown picks it up automatically).
4. Update the archetype table in the root README and agent instructions.
5. Evaluate: does recall for the new archetype beat chance?

## Checklist for any feature

- [ ] Schema change applied idempotently, documented
- [ ] Parameterized SQL
- [ ] Input validated and clamped
- [ ] Auth level chosen on purpose
- [ ] Span or log added; trace id kept
- [ ] Types updated at the API boundary on both sides
- [ ] Test for the pure logic
- [ ] READMEs and these notes updated
