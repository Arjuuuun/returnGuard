# 08. Roadmap, cost and preserved planning notes

This file keeps the content of the old `backend/README.md` (a planning document) that did not fit the new public README.

## Original motivation

- Ties to real e-commerce production experience (client work on Uniqlo's platform).
- Stronger system-design interview story than a support-ticket bot: event-driven ingestion, an AI agent in the loop, vector similarity search, full observability.
- Produces real precision/recall numbers because the data has injected ground truth.

## Original planned architecture (target)

Return submitted with optional photo, Blob Storage, Event Grid, Service Bus, Azure Function, Foundry agent with KB / similar-case tool, Postgres + pgvector, **Redis per-customer risk cache**, React dashboard, OpenTelemetry to Application Insights.

Supporting infra planned: **Key Vault** (model API key), **App Configuration** (model name, feature flag with Sentinel-key refresh), **Azure Container Apps via ACR**, **managed identity** throughout.

## Status snapshot (2026-10-15)

| Item | State |
|------|-------|
| Postgres, schema, pgvector | Done |
| Synthetic data, 6 archetypes, verify script | Done |
| Blob, Event Grid, Service Bus ingestion | Done |
| Function trigger, Foundry agent | Done |
| Similar-case tool (embeddings, pgvector, HTTP) | Done |
| OpenTelemetry to App Insights, trace links | Done |
| React dashboard | Done |
| Redis cache | Not started |
| Key Vault, App Configuration, feature flags | Not started |
| Container Apps + ACR deployment | Not started |
| Tests, evaluation, KQL analytics page | Not started |
| Base-rate numbers in README ("TODO" in old README) | Run `verify-seed.ts` and paste into the root README |

## Suggested next milestones

1. **M1 Hygiene (1 session):** git init, root `.gitignore`, add `openai`, export schema, config module.
2. **M2 Correctness (1 session):** idempotent insert, clamp inputs, latest-score query, tests for pure functions.
3. **M3 Visible feature (1-2 sessions):** persist and display similar cases (file 06, recipe 1).
4. **M4 Quality proof (2 sessions):** evaluation harness (recipe 3), record baseline metrics in the README.
5. **M5 Signal upgrade (2-3 sessions):** customer profile features (recipe 2), re-evaluate.
6. **M6 Security + deploy (2-3 sessions):** auth, Key Vault, App Configuration, CI/CD, Container Apps.
7. **M7 Stretch:** A/B model switching, KQL analytics page, SignalR live updates, image hashing.

## Cost notes (from original plan)

- Budget alert at $25 on day 0.
- Expected during the 2-week build: roughly $10-20, covered by Azure's $200 / 30-day credit.
- If left running: roughly $30-40 per month (Redis, Postgres compute after the 12-month free window, Container Registry have no ongoing free tier).
- Day-14 teardown order: stop Postgres, delete Redis outright, scale Container Apps to zero, keep the infrastructure provisioning script for redeploys.
- New cost to track: Foundry agent calls with `detail: "high"` images and embedding calls on the public tool endpoint (anonymous, so anyone who finds the URL can spend tokens: see S1).

## Rebuild notes

Resources the system depends on (for a rebuild or IaC):

- Resource group, PostgreSQL Flexible Server (`returnGuard` DB, `vector` extension allow-listed)
- Storage account with a container for return photos, system topic + Event Grid subscription (event type BlobCreated) to a Service Bus queue `return-guard-queue`
- Function App (Node 20+, v4 model) with identity roles: Storage Blob Data Reader, Service Bus Data Receiver, Foundry user role
- Foundry resource + project, a chat/vision model deployment, `text-embedding-3-large` deployment, agent `return-fraud-scorer` with the OpenAPI tool pointing at `/api/find-similar-returns`
- Application Insights (connection string used by the OTel exporter)
- Local only: Azurite, ngrok tunnel for the tool endpoint
