import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { pool } from "../../db";

export async function getReturnDetail(
    request: HttpRequest,
    context: InvocationContext
): Promise<HttpResponseInit> {
    const returnId = request.params.id;

    context.log(`getReturnDetail called for id=${returnId}`);

    if (!returnId) {
        return { status: 400, headers: { 'Access-Control-Allow-Origin': '*' }, jsonBody: { error: 'Missing return id' } };
    }

    const { rows } = await pool.query(
        `SELECT r.id, r.reason,
          rs.score, rs.reasoning, rs.scored_at, rs.reasoning_trace_id, rs.similar_cases,
          fl.archetype
   FROM returns r
   LEFT JOIN risk_scores rs ON rs.return_id = r.id
   LEFT JOIN fraud_labels fl ON fl.return_id = r.id
   WHERE r.id = $1`,
        [returnId]
    );

    if (!rows || rows.length === 0) {
        return { status: 404, headers: { 'Access-Control-Allow-Origin': '*' }, jsonBody: { error: 'Return not found' } };
    }

    const r = rows[0];

    const similar = (r.similar_cases || []) as any[];

    return {
        status: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        jsonBody: {
            id: r.id,
            reason: r.reason,
            archetype: r.archetype,
            score: r.score,
            reasoning: r.reasoning,
            scored_at: r.scored_at,
            reasoning_trace_id: r.reasoning_trace_id,
            similar_cases: similar,
        }
    };
}

app.http('getReturnDetail', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'returns/{id}',
    handler: getReturnDetail
});