import { getConnection } from "@/lib/db";

type TableName = "subjects" | "data_pulls" | "data_pull" | "logs";

type SubjectRow = {
    subject_id: string;
    site_id: string;
    created_at: string | null;
};

type PullCountRow = {
    subject_id: string;
    total_pulls: string;
    pulls_with_unique_file_md5: string;
};

type PullDetailRow = {
    subject_id: string;
    data_source_name: string | null;
    pull_timestamp: string | null;
    has_file_md5: boolean;
};

type TrendRow = {
    subject_id: string;
    day: string;
    pulls_with_unique_file_md5: string;
};

type WarningRow = {
    log_timestamp: string;
    log_level: string;
    log_message: Record<string, unknown>;
};

const CREATED_AT_JSON_REGEX = "^\\d{4}-\\d{2}-\\d{2}([ T].*)?$";
const DATE_ONLY_JSON_REGEX = "^\\d{4}-\\d{2}-\\d{2}$";

async function getColumns(tableName: TableName): Promise<Set<string>> {
    const connection = getConnection();
    const result = await connection.query(
        `
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = $1
        `,
        [tableName]
    );

    return new Set(result.rows.map((row: { column_name: string }) => row.column_name));
}

async function getFirstExistingTable(tableNames: TableName[]): Promise<TableName | null> {
    const connection = getConnection();
    const result = await connection.query(
        `
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = ANY($1::text[])
        `,
        [tableNames]
    );

    const existing = new Set(result.rows.map((row: { table_name: string }) => row.table_name));
    for (const candidate of tableNames) {
        if (existing.has(candidate)) {
            return candidate;
        }
    }

    return null;
}

function pickFirstColumn(columns: Set<string>, candidates: string[]): string | null {
    for (const candidate of candidates) {
        if (columns.has(candidate)) {
            return candidate;
        }
    }
    return null;
}

function quoteIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, "\"\"")}"`;
}

function parseCount(value: string | number | null | undefined): number {
    if (typeof value === "number") return value;
    if (!value) return 0;
    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
}

export async function GET(
    request: Request,
    props: { params: Promise<{ project_id: string }> }
): Promise<Response> {
    const params = await props.params;
    const projectId = params.project_id;

    if (!projectId) {
        return new Response(JSON.stringify({ error: "Missing project_id" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
        });
    }

    const connection = getConnection();

    const dataPullTable = await getFirstExistingTable(["data_pulls", "data_pull"]);

    const [subjectColumns, dataPullColumns, logColumns] = await Promise.all([
        getColumns("subjects"),
        dataPullTable ? getColumns(dataPullTable) : Promise.resolve(new Set<string>()),
        getColumns("logs"),
    ]);

    if (!subjectColumns.has("project_id") || !subjectColumns.has("subject_id") || !subjectColumns.has("site_id") || !subjectColumns.has("subject_metadata")) {
        return new Response(
            JSON.stringify({
                error: "subjects table is missing required columns",
                required: ["project_id", "subject_id", "site_id", "subject_metadata"],
            }),
            {
                status: 500,
                headers: { "Content-Type": "application/json" },
            }
        );
    }

    const hasDataPullSubjectColumn = Boolean(dataPullTable) && dataPullColumns.has("subject_id");
    const hasDataPullProjectColumn = dataPullColumns.has("project_id");
    const dataPullTableSql = dataPullTable ? `public.${quoteIdentifier(dataPullTable)}` : null;

    const pullSourceColumn = pickFirstColumn(dataPullColumns, [
        "data_source_name",
        "source_name",
        "data_source_identifier",
    ]);

    const pullTimestampColumn = pickFirstColumn(dataPullColumns, [
        "pull_timestamp",
        "created_at",
        "inserted_at",
        "updated_at",
    ]);

    const hasFileMd5Column = dataPullColumns.has("file_md5");

    const subjectCreatedAtExpression = subjectColumns.has("created_at")
        ? "created_at::timestamptz"
        : `
            COALESCE(
                CASE
                    WHEN subject_metadata ? 'created_at'
                    AND (subject_metadata->>'created_at') ~ '${CREATED_AT_JSON_REGEX}'
                    THEN (subject_metadata->>'created_at')::timestamptz
                    ELSE NULL
                END,
                CASE
                    WHEN subject_metadata ? 'consent_date'
                    AND (subject_metadata->>'consent_date') ~ '${DATE_ONLY_JSON_REGEX}'
                    THEN (subject_metadata->>'consent_date')::date::timestamptz
                    ELSE NULL
                END
            )
        `;

    const missingSubjectsQuery = `
        SELECT
            subject_id,
            site_id,
            ${subjectCreatedAtExpression} AS created_at
        FROM public.subjects
        WHERE project_id = $1
          AND COALESCE(subject_metadata->>'missing_required_variables', 'NOT_EMPTY') = ''
        ORDER BY site_id, subject_id
    `;

    const missingSubjectsResult = await connection.query(missingSubjectsQuery, [projectId]);
    const missingSubjects = missingSubjectsResult.rows as SubjectRow[];

    const missingSubjectIds = missingSubjects.map((row) => row.subject_id);
    const siteSubjectMap = missingSubjects.reduce<Record<string, string[]>>((acc, row) => {
        if (!acc[row.site_id]) {
            acc[row.site_id] = [];
        }
        acc[row.site_id].push(row.subject_id);
        return acc;
    }, {});

    const sinceLastNightQuery = `
        SELECT
            subject_id,
            site_id,
            ${subjectCreatedAtExpression} AS created_at
        FROM public.subjects
        WHERE project_id = $1
          AND COALESCE(subject_metadata->>'missing_required_variables', 'NOT_EMPTY') = ''
          AND ${subjectCreatedAtExpression} >= date_trunc('day', now()) - interval '1 day'
          AND ${subjectCreatedAtExpression} < date_trunc('day', now())
        ORDER BY created_at DESC NULLS LAST
    `;

    const sinceLastNightResult = await connection.query(sinceLastNightQuery, [projectId]);

    let pullCountsBySubject: Array<{ subject_id: string; total_pulls: number; pulls_with_unique_file_md5: number }> = [];
    let pullDetailsBySubject: Array<{ subject_id: string; data_source_name: string | null; pull_timestamp: string | null; has_file_md5: boolean }> = [];
    let pullTrendBySubject: Array<{ subject_id: string; day: string; pulls_with_unique_file_md5: number }> = [];

    if (missingSubjectIds.length > 0 && hasDataPullSubjectColumn && dataPullTableSql) {
        const uniqueFileMd5CountExpr = hasFileMd5Column
            ? `COUNT(DISTINCT NULLIF(file_md5::text, ''))`
            : "0";

        const pullCountsQuery = `
            SELECT
                subject_id,
                COUNT(*)::int AS total_pulls,
                ${uniqueFileMd5CountExpr}::int AS pulls_with_unique_file_md5
            FROM ${dataPullTableSql}
            WHERE subject_id = ANY($1::text[])
              ${hasDataPullProjectColumn ? "AND project_id = $2" : ""}
            GROUP BY subject_id
            ORDER BY subject_id
        `;

        const pullCountsParams = hasDataPullProjectColumn ? [missingSubjectIds, projectId] : [missingSubjectIds];
        const pullCountsResult = await connection.query(pullCountsQuery, pullCountsParams);
        pullCountsBySubject = (pullCountsResult.rows as PullCountRow[]).map((row) => ({
            subject_id: row.subject_id,
            total_pulls: parseCount(row.total_pulls),
            pulls_with_unique_file_md5: parseCount(row.pulls_with_unique_file_md5),
        }));

        if (pullTimestampColumn) {
            const pullSourceSelect = pullSourceColumn ? `${quoteIdentifier(pullSourceColumn)}::text` : "NULL";
            const hasFileMd5Expr = hasFileMd5Column
                ? `COALESCE(file_md5::text, '') <> ''`
                : "false";

            const pullDetailsQuery = `
                SELECT
                    subject_id,
                    ${pullSourceSelect} AS data_source_name,
                    ${quoteIdentifier(pullTimestampColumn)}::timestamptz AS pull_timestamp,
                    ${hasFileMd5Expr} AS has_file_md5
                FROM ${dataPullTableSql}
                WHERE subject_id = ANY($1::text[])
                  ${hasDataPullProjectColumn ? "AND project_id = $2" : ""}
                  ${hasFileMd5Column ? "AND COALESCE(file_md5::text, '') <> ''" : ""}
                ORDER BY ${quoteIdentifier(pullTimestampColumn)} DESC NULLS LAST
                LIMIT 200
            `;

            const pullDetailsParams = hasDataPullProjectColumn ? [missingSubjectIds, projectId] : [missingSubjectIds];
            const pullDetailsResult = await connection.query(pullDetailsQuery, pullDetailsParams);
            pullDetailsBySubject = (pullDetailsResult.rows as PullDetailRow[]).map((row) => ({
                subject_id: row.subject_id,
                data_source_name: row.data_source_name,
                pull_timestamp: row.pull_timestamp,
                has_file_md5: row.has_file_md5,
            }));

            const trendCountExpr = hasFileMd5Column
                ? `COUNT(DISTINCT NULLIF(file_md5::text, ''))`
                : "COUNT(*)";

            const pullTrendQuery = `
                SELECT
                    subject_id,
                    date_trunc('day', ${quoteIdentifier(pullTimestampColumn)}::timestamptz)::date AS day,
                    ${trendCountExpr}::int AS pulls_with_unique_file_md5
                FROM ${dataPullTableSql}
                WHERE subject_id = ANY($1::text[])
                  ${hasDataPullProjectColumn ? "AND project_id = $2" : ""}
                  AND ${quoteIdentifier(pullTimestampColumn)} IS NOT NULL
                GROUP BY subject_id, day
                ORDER BY day DESC, subject_id
                LIMIT 500
            `;

            const pullTrendParams = hasDataPullProjectColumn ? [missingSubjectIds, projectId] : [missingSubjectIds];
            const pullTrendResult = await connection.query(pullTrendQuery, pullTrendParams);
            pullTrendBySubject = (pullTrendResult.rows as TrendRow[]).map((row) => ({
                subject_id: row.subject_id,
                day: row.day,
                pulls_with_unique_file_md5: parseCount(row.pulls_with_unique_file_md5),
            }));
        }
    }

    let lastWarnings: Array<{ timestamp: string; level: string; message: string; site_id: string | null; subject_id: string | null; data_source_name: string | null }> = [];

    if (logColumns.has("log_level") && logColumns.has("log_message") && logColumns.has("log_timestamp")) {
        const warningsQuery = `
            SELECT log_timestamp, log_level, log_message
            FROM public.logs
                        WHERE log_level::text ILIKE 'WARN%'
              AND log_message->>'project_id' = $1
                            AND COALESCE(log_message->>'message', '') NOT ILIKE 'Record with subject_id % is missing required variables:%'
            ORDER BY log_timestamp DESC
                        LIMIT 20
        `;

        const warningsResult = await connection.query(warningsQuery, [projectId]);
        lastWarnings = (warningsResult.rows as WarningRow[]).map((row) => {
            const message = row.log_message ?? {};
            return {
                timestamp: row.log_timestamp,
                level: row.log_level,
                message: typeof message.message === "string" ? message.message : JSON.stringify(message),
                site_id: typeof message.site_id === "string" ? message.site_id : null,
                subject_id: typeof message.subject_id === "string" ? message.subject_id : null,
                data_source_name: typeof message.data_source_name === "string" ? message.data_source_name : null,
            };
        });
    }

    const pullCountsMap = new Map(
        pullCountsBySubject.map((item) => [item.subject_id, item])
    );

    const coverageBySubject = missingSubjectIds.map((subjectId) => {
        const counts = pullCountsMap.get(subjectId);
        const details = pullDetailsBySubject.filter((detail) => detail.subject_id === subjectId);
        return {
            subject_id: subjectId,
            total_pulls: counts?.total_pulls ?? 0,
            pulls_with_unique_file_md5: counts?.pulls_with_unique_file_md5 ?? 0,
            recent_pull_items: details,
        };
    });

    const response = {
        project_id: projectId,
        summary: {
            subjects_missing_required_variables_count: missingSubjectIds.length,
            subjects_missing_required_variables_by_site: Object.entries(siteSubjectMap).map(([site_id, subject_ids]) => ({
                site_id,
                count: subject_ids.length,
                subject_ids,
            })),
            newly_added_last_night_count: sinceLastNightResult.rows.length,
        },
        newly_added_last_night: (sinceLastNightResult.rows as SubjectRow[]).map((row) => ({
            subject_id: row.subject_id,
            site_id: row.site_id,
            created_at: row.created_at,
        })),
        data_pull_coverage_by_subject: coverageBySubject,
        data_pull_trend_by_subject: pullTrendBySubject,
        last_warning_logs: lastWarnings,
        metadata: {
            notes: {
                pull_timestamp_column: pullTimestampColumn,
                pull_source_column: pullSourceColumn,
                file_md5_available: hasFileMd5Column,
                data_pulls_available: hasDataPullSubjectColumn,
                data_pull_table: dataPullTable,
                data_pulls_columns: [...dataPullColumns],
            },
        },
    };

    return new Response(JSON.stringify(response), {
        headers: {
            "Content-Type": "application/json",
        },
    });
}
