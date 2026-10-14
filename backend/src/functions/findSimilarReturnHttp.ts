/**
 * findSimilarReturnsHttp.ts
 *
 * HTTP-triggered Function endpoint that wraps findSimilarReturns, so the
 * Foundry agent can call it as an OpenAPI tool mid-run.
 *
 * Route: POST /api/find-similar-returns
 * Body:  { "reason": "item arrived damaged", "return_id": "optional-uuid" }
 *
 * Uses the Azure Functions v4 programming model — adjust the app.http(...)
 * registration if your existing functions (e.g. scoreReturn) use a
 * different style (function.json-based v3 model instead).
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { findSimilarReturns } from "../services/find_similar_return";

interface FindSimilarReturnsBody {
    reason: string;
    return_id?: string;
    k?: number;
}

export async function findSimilarReturnsHttp(
    request: HttpRequest,
    context: InvocationContext
): Promise<HttpResponseInit> {
    let body: FindSimilarReturnsBody;

    try {
        body = (await request.json()) as FindSimilarReturnsBody;
    } catch {
        return { status: 400, jsonBody: { error: "Invalid JSON body" } };
    }

    if (!body.reason || typeof body.reason !== "string") {
        return { status: 400, jsonBody: { error: "`reason` is required and must be a string" } };
    }

    try {
        const summary = await findSimilarReturns(
            body.reason,
            body.k ?? 10,
            body.return_id
        );
        return { status: 200, jsonBody: summary };
    } catch (err) {
        context.error("findSimilarReturnsHttp failed:", err);
        return { status: 500, jsonBody: { error: "Internal error running similarity search" } };
    }
}

app.http("findSimilarReturns", {
    methods: ["POST"],
    authLevel: "anonymous", // simplified for local ngrok testing; add authLevel: "function" + a key back before real deployment
    route: "find-similar-returns",
    handler: findSimilarReturnsHttp,
});