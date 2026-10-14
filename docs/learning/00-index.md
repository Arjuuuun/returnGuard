# ReturnGuard Learning Notes (private study material)

These files are for me, not for repo visitors. The public-facing docs are the three READMEs. Written 2026-10-15 from a full read of the code.

| # | File | Use it to |
|---|------|-----------|
| 01 | [What it does, end to end](01-what-it-does.md) | Retell the whole system in 2 minutes |
| 02 | [Architecture deep dive](02-architecture-deep-dive.md) | Know every file, data shape and boundary |
| 03 | [Concepts and learning points](03-concepts-and-learning-points.md) | Study the underlying technology |
| 04 | [Practices: done well vs. to improve](04-practices.md) | Spot habits to keep and habits to fix |
| 05 | [Gaps and known issues](05-gaps-and-known-issues.md) | Prioritized fix list with file references |
| 06 | [Adding new features](06-adding-new-features.md) | Step-by-step recipes for extending the system |
| 07 | [System design options](07-system-design-options.md) | Alternative designs, scaling, interview framing |
| 08 | [Roadmap, cost and old plan](08-roadmap-and-cost.md) | Planned work, budget, preserved planning notes |

## Suggested reading order

1. 01 then 02 (understand what exists).
2. 05 (understand what is wrong or missing).
3. 03 (fill knowledge gaps behind each Azure/AI piece).
4. 06 and 07 (learn by extending and by redesigning).
5. 04 (reflect on habits).

## Study plan (4 short sessions)

1. **Trace one return by hand.** Insert a return, upload a photo named `<return_id>.jpg`, watch Service Bus, the Function log, the `risk_scores` row, the dashboard, and the App Insights trace. Explain each hop out loud.
2. **Break it on purpose.** Send a non-image, a tiny blob, an unknown id, a malformed agent reply. Predict behavior from the code first, then verify.
3. **Close three gaps from file 05.** Suggested: idempotent insert, config out of source, `openai` dependency plus tests for pure functions.
4. **Build one feature from file 06.** Suggested: persist `similar_cases`, then show them on the detail page.

## Interview angle

The story is "event-driven pipeline with an AI agent in the loop, vector retrieval as an agent tool, ground-truth labels for evaluation, traces linked to every decision." File 07 has the design questions that story invites.
