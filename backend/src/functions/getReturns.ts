import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { pool } from "../../db";

export async function getReturns(
    request: HttpRequest,
    context: InvocationContext
): Promise<HttpResponseInit> {
    const risk = request.query.get('risk');       // e.g. 'high' or null
    const search = request.query.get('search');    // e.g. return ID substring
    const limit = Number(request.query.get('limit') ?? '50');
    const offset = Number(request.query.get('offset') ?? '0');

    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;


    if (risk === 'high') {
        conditions.push(`rs.score > $${paramIndex++}`);
        params.push(0.7);
    }

    if (search) {
        conditions.push(`r.id::text ILIKE $${paramIndex++}`);
        params.push(`%${search}%`);
    }

    context.log(`getReturns called with risk=${risk}, search=${search}, limit=${limit}, offset=${offset}`);

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    params.push(limit);
    const limitParam = paramIndex++;
    params.push(offset);
    const offsetParam = paramIndex++;

    const query = `
    SELECT r.id, r.reason, r.submitted_at,
           rs.score, rs.reasoning, rs.scored_at, rs.reasoning_trace_id,
           fl.archetype
    FROM returns r
    LEFT JOIN risk_scores rs ON rs.return_id = r.id
    LEFT JOIN fraud_labels fl ON fl.return_id = r.id
    ${whereClause}
    ORDER BY rs.score DESC NULLS LAST
    LIMIT $${limitParam} OFFSET $${offsetParam}
  `;

    context.log('getReturns query:', query, params);

    const { rows } = await pool.query(query, params);

    // stub response for now — real query comes next
    return {
        status: 200,
        headers: {
            'Access-Control-Allow-Origin': '*'
        },
        jsonBody: {
            returns: rows,
            meta: { risk, search, limit, offset, count: rows.length },
            _corsDebugMarker: 'v2'
        }

    };
}

app.http('getReturns', {
    methods: ['GET'],
    authLevel: 'anonymous', // fine for local dev; revisit before any real deploy
    route: 'returns',
    handler: getReturns
});