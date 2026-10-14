# 04. Practices: what is done well, what to improve

## Done well (keep doing)

| Practice | Evidence |
|----------|----------|
| Parameterized SQL | All queries in `src/` and scripts use `$n` |
| Validate untrusted AI output | `isAgentRiskAssessment` type guard, throw on mismatch |
| Validate before building | `check_reason_archetype_correlation.ts` before embeddings |
| Idempotent setup | `seed.ts` truncate + `IF NOT EXISTS`; product upsert by `external_id` |
| Isolation of steps | Each seed step is a child process with its own pool |
| Sanity checks as code | `verify-seed.ts`: counts, ratios, orphan checks, spot samples |
| Business record linked to telemetry | `reasoning_trace_id` column + deep link in UI |
| Meaningful spans | Root span plus a child span just around the agent call |
| Secrets out of git | `.env`, `local.settings.json` in `.gitignore` |
| No secrets in cloud auth path | `DefaultAzureCredential` for Blob and Foundry |
| Debounced search | `FilterBar` 300 ms |
| Boundary normalization | `normalizeReturn` handles NUMERIC strings |
| Comments explain "why" | Vector literal note, `unit_price` snapshot, debounce, ESLint disables |
| Thin triggers | HTTP wrapper delegates to the service |
| Documented decisions | Prisma abandonment, anonymous auth flagged in-file |
| Realistic synthetic skew | Tiered order distribution |

## To improve (habits to build)

### Correctness and safety
1. **Make consumers idempotent.** Assume every message may repeat. Add a unique key and `ON CONFLICT`.
2. **Fail loudly on missing data.** `rows[0]` is used without checking that a row exists.
3. **Clamp user input.** `limit`/`offset` are `Number(...)` of query params: `NaN`, negatives, and huge values pass through.
4. **Do not log full payloads/queries in production.** `console.log(JSON.stringify(message))` and the full SQL with params are noisy and may leak data.
5. **Auth by default.** Start endpoints at `function` level; open them only on purpose.
6. **Least-privilege database user.** The Function uses one `DATABASE_URL`; the read APIs only need SELECT.
7. **TLS properly.** `rejectUnauthorized: false` disables certificate verification. Use the Azure CA bundle.

### Configuration
8. Remove hardcoded resource names (blob account, Foundry endpoint, agent version). One config module that reads env and fails fast with a clear message.
9. Key Vault references for secrets, App Configuration for non-secrets and the agent version.

### Quality
10. **Tests.** Start with pure functions: `toVectorLiteral`, `isAgentRiskAssessment`, `normalizeReturn`, `riskLabel`, blob-path parsing (extract and unit test it). Then integration tests against a throwaway Postgres container.
11. **Lint and format on the backend.** The frontend has ESLint; the backend has none.
12. **Turn on `strict`.** Do it incrementally with `// @ts-expect-error` where needed.
13. **Consistent naming.** `scoreReturn.ts`, `find_similar_return.ts`, `findSimilarReturnHttp.ts`, `verify-seed.ts` vs `import_product.ts`. Pick camelCase for files and keep one separator style. (Deliberately left alone so far; fix in a dedicated change.)
14. **Dead code.** The downloaded `imageBuffer`, `_corsDebugMarker`, "stub response" comment, unused return from insert.
15. **Dependencies declared.** `openai` must be in `package.json`. Move `helmet` out if unused (not imported anywhere in `src/`).
16. **Single source of truth for thresholds.** 0.7 high / 0.4 medium appear in three places.

### Delivery
17. **Version the agent definition in git.** Instructions, tools, OpenAPI spec.
18. **Migrations.** Introduce a migration tool and a checked-in baseline `schema.sql` (the old README referenced one that is not in the repo).
19. **CI.** Build, lint, test on every push.
20. **A root `.gitignore`** and a decision about `azurite-data/` and `azurite-debug.log` (they are artifacts; the backend ignore file covers part of them).
21. **Initialize git.** The folder is not a repository yet; commit early so history exists.

## Personal working-style notes

- The README-first, plan-first approach (execution plan, data-layer plan) is a strength. Keep a living "decisions" log (ADR style): one short file per decision with context, choice, consequences.
- Re-seeding wipes everything, including any real `risk_scores`. Add a guard (`--yes` flag or environment check) before `TRUNCATE`.
- When a tool fights you (Prisma), the right move was to drop it and document why. Next time, also record what you lost.
