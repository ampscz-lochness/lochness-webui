import { getConnection } from "@/lib/db";

type LogRow = {
    log_level: string;
    log_message: Record<string, unknown> | null;
    log_timestamp: string;
};

const DATA_PULL_FILTER_SQL = `
    (
        lower(coalesce(log_message->>'message', '')) LIKE '%pull%'
        OR lower(coalesce(log_message->>'message', '')) LIKE '%fetched%'
        OR lower(coalesce(log_message->>'event', '')) LIKE '%pull%'
    )
`;

/**
 * Returns recent data pull-like log events for a site.
 */
export async function GET(
    request: Request,
    props: { params: Promise<{ project_id: string; site_id: string }> }
): Promise<Response> {
    const params = await props.params;
    const project_id = params.project_id;
    const site_id = params.site_id;

    if (!project_id || !site_id) {
        return new Response(JSON.stringify({ error: "Missing project_id or site_id parameter" }), {
            status: 400,
            headers: {
                "Content-Type": "application/json",
            },
        });
    }

    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get("limit") || "20", 10);
    const offset = parseInt(url.searchParams.get("offset") || "0", 10);

    const safeLimit = Number.isNaN(limit) ? 20 : Math.max(1, Math.min(limit, 100));
    const safeOffset = Number.isNaN(offset) ? 0 : Math.max(0, offset);

    const connection = getConnection();

    const whereSql = `
        WHERE log_message->>'project_id' = $1
          AND log_message->>'site_id' = $2
          AND ${DATA_PULL_FILTER_SQL}
    `;

    const countQuery = `
        SELECT COUNT(*)::int AS count
        FROM public.logs
        ${whereSql}
    `;

    const rowsQuery = `
        SELECT log_level, log_message, log_timestamp
        FROM public.logs
        ${whereSql}
        ORDER BY log_timestamp DESC
        LIMIT $3 OFFSET $4
    `;

    const [countResult, rowsResult] = await Promise.all([
        connection.query(countQuery, [project_id, site_id]),
        connection.query(rowsQuery, [project_id, site_id, safeLimit, safeOffset]),
    ]);

    const rows = (rowsResult.rows as LogRow[]).map((row, index) => {
        const message = row.log_message ?? {};
        const route = typeof message.route === "string" ? message.route : null;
        const eventMessage = typeof message.message === "string" ? message.message : "Data pull event";
        const dataSourceName = typeof message.data_source_name === "string" ? message.data_source_name : null;
        const statusCode = typeof message.status_code === "number" ? message.status_code : null;

        return {
            id: `${row.log_timestamp}-${index}`,
            log_level: row.log_level,
            log_timestamp: row.log_timestamp,
            message: eventMessage,
            route,
            data_source_name: dataSourceName,
            status_code: statusCode,
            raw: message,
        };
    });

    const metadata = {
        totalRows: countResult.rows[0]?.count ?? 0,
        limit: safeLimit,
        offset: safeOffset,
    };

    return new Response(JSON.stringify({ metadata, rows }), {
        headers: {
            "Content-Type": "application/json",
        },
    });
}
