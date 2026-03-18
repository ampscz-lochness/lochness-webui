import { getConnection } from "@/lib/db";

type TableName = "subjects" | "data_pulls" | "data_pull" | "logs" | "files";

type SubjectRow = {
    subject_id: string;
    site_id: string;
    created_at: string | null;
};

type ConsentDateRow = {
    subject_id: string;
    consent_date: string | null;
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
    file_md5: string | null;
    file_path: string | null;
    has_file_md5: boolean;
};

type TrendRow = {
    subject_id: string;
    day: string;
    pulls_with_unique_file_md5: string;
    is_consent_date: boolean;
};

type TrendByModalityRow = {
    subject_id: string;
    modality_key: string | null;
    day: string;
    pulls_with_unique_file_md5: string;
    is_consent_date: boolean;
};

type WarningRow = {
    log_timestamp: string;
    log_level: string;
    log_message: Record<string, unknown>;
};

type FilePathCountRow = {
    subject_id: string;
    data_source_name: string | null;
    unique_file_paths: string;
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
    const filesTable = await getFirstExistingTable(["files"]);

    const [subjectColumns, dataPullColumns, logColumns, filesColumns] = await Promise.all([
        getColumns("subjects"),
        dataPullTable ? getColumns(dataPullTable) : Promise.resolve(new Set<string>()),
        getColumns("logs"),
        filesTable ? getColumns(filesTable) : Promise.resolve(new Set<string>()),
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
    const filesTableSql = filesTable ? `public.${quoteIdentifier(filesTable)}` : null;

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
    const pullFilePathColumn = pickFirstColumn(dataPullColumns, ["file_path", "filepath", "path"]);

    const hasFileMd5Column = dataPullColumns.has("file_md5");

    const filesSourceColumn = pickFirstColumn(filesColumns, [
        "data_source_name",
        "source_name",
        "data_source_identifier",
    ]);
    const filesPathColumn = pickFirstColumn(filesColumns, ["file_path", "filepath", "path"]);
    const hasFilesFileMd5Column = filesColumns.has("file_md5");
    const hasFilesProjectColumn = filesColumns.has("project_id");

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

    let consentDatesBySubject: Array<{ subject_id: string; consent_date: string | null }> = [];
    if (missingSubjectIds.length > 0) {
        const consentDatesQuery = `
            SELECT
                subject_id,
                NULLIF(subject_metadata->>'consent_date', '')::text AS consent_date
            FROM public.subjects
            WHERE project_id = $1
              AND subject_id = ANY($2::text[])
            ORDER BY subject_id
        `;

        const consentDatesResult = await connection.query(consentDatesQuery, [projectId, missingSubjectIds]);
        consentDatesBySubject = (consentDatesResult.rows as ConsentDateRow[]).map((row) => ({
            subject_id: row.subject_id,
            consent_date: row.consent_date,
        }));
    }

    let pullCountsBySubject: Array<{ subject_id: string; total_pulls: number; pulls_with_unique_file_md5: number }> = [];
    let pullDetailsBySubject: Array<{ subject_id: string; data_source_name: string | null; pull_timestamp: string | null; file_md5: string | null; file_path: string | null; has_file_md5: boolean }> = [];
    let pullTrendBySubject: Array<{ subject_id: string; day: string; pulls_with_unique_file_md5: number; is_consent_date: boolean }> = [];
    let pullTrendBySubjectAndModality: Array<{ subject_id: string; modality_key: string | null; day: string; pulls_with_unique_file_md5: number; is_consent_date: boolean }> = [];
    let uniqueFilePathsByDataSource: Array<{ subject_id: string; data_source_name: string | null; unique_file_paths: number }> = [];

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
                WITH filtered AS (
                    SELECT
                        subject_id,
                        ${pullSourceSelect} AS data_source_name,
                        ${quoteIdentifier(pullTimestampColumn)}::timestamptz AS pull_timestamp,
                        ${hasFileMd5Column ? "NULLIF(file_md5::text, '')" : "NULL::text"} AS file_md5,
                        ${pullFilePathColumn ? `NULLIF(${quoteIdentifier(pullFilePathColumn)}::text, '')` : "NULL::text"} AS file_path,
                        ${hasFileMd5Expr} AS has_file_md5
                    FROM ${dataPullTableSql}
                    WHERE subject_id = ANY($1::text[])
                      ${hasDataPullProjectColumn ? "AND project_id = $2" : ""}
                      ${hasFileMd5Column ? "AND COALESCE(file_md5::text, '') <> ''" : ""}
                )
                SELECT DISTINCT ON (subject_id, COALESCE(data_source_name, 'unknown'), file_md5)
                    subject_id,
                    data_source_name,
                    pull_timestamp,
                    file_md5,
                    file_path,
                    has_file_md5
                FROM filtered
                ORDER BY subject_id, COALESCE(data_source_name, 'unknown'), file_md5, pull_timestamp DESC NULLS LAST
                LIMIT 2000
            `;

            const pullDetailsParams = hasDataPullProjectColumn ? [missingSubjectIds, projectId] : [missingSubjectIds];
            const pullDetailsResult = await connection.query(pullDetailsQuery, pullDetailsParams);
            pullDetailsBySubject = (pullDetailsResult.rows as PullDetailRow[]).map((row) => ({
                subject_id: row.subject_id,
                data_source_name: row.data_source_name,
                pull_timestamp: row.pull_timestamp,
                file_md5: row.file_md5,
                file_path: row.file_path,
                has_file_md5: row.has_file_md5,
            }));

            const pullTrendQuery = `
                WITH consent_by_subject AS (
                    SELECT
                        subject_id,
                        CASE
                            WHEN NULLIF(subject_metadata->>'consent_date', '') ~ '^\\d{4}-\\d{2}-\\d{2}$'
                                THEN NULLIF(subject_metadata->>'consent_date', '')::date
                            WHEN NULLIF(subject_metadata->>'consent_date', '') ~ '^\\d{4}-\\d{2}-\\d{2}[ T].*$'
                                THEN NULLIF(subject_metadata->>'consent_date', '')::timestamptz::date
                            WHEN NULLIF(subject_metadata->>'consent_date', '') ~ '^\\d{1,2}/\\d{1,2}/\\d{4}$'
                                THEN to_date(NULLIF(subject_metadata->>'consent_date', ''), 'MM/DD/YYYY')
                            ELSE NULL
                        END AS consent_date
                    FROM public.subjects
                    WHERE project_id = $2
                      AND subject_id = ANY($1::text[])
                ),
                trend_by_subject AS (
                    ${hasFileMd5Column ? `
                    WITH first_seen_md5 AS (
                        SELECT
                            subject_id,
                            MIN(date_trunc('day', ${quoteIdentifier(pullTimestampColumn)}::timestamptz)::date) AS day,
                            NULLIF(file_md5::text, '') AS file_md5
                        FROM ${dataPullTableSql}
                        WHERE subject_id = ANY($1::text[])
                          ${hasDataPullProjectColumn ? "AND project_id = $2" : ""}
                          AND ${quoteIdentifier(pullTimestampColumn)} IS NOT NULL
                          AND COALESCE(file_md5::text, '') <> ''
                        GROUP BY subject_id, NULLIF(file_md5::text, '')
                    )
                    SELECT
                        subject_id,
                        day,
                        COUNT(*)::int AS pulls_with_unique_file_md5
                    FROM first_seen_md5
                    GROUP BY subject_id, day
                    ` : `
                    SELECT
                        subject_id,
                        date_trunc('day', ${quoteIdentifier(pullTimestampColumn)}::timestamptz)::date AS day,
                        COUNT(*)::int AS pulls_with_unique_file_md5
                    FROM ${dataPullTableSql}
                    WHERE subject_id = ANY($1::text[])
                      ${hasDataPullProjectColumn ? "AND project_id = $2" : ""}
                      AND ${quoteIdentifier(pullTimestampColumn)} IS NOT NULL
                    GROUP BY subject_id, day
                    `}
                )
                SELECT
                    t.subject_id,
                    t.day,
                    t.pulls_with_unique_file_md5,
                    (c.consent_date IS NOT NULL AND t.day = c.consent_date) AS is_consent_date
                FROM trend_by_subject t
                LEFT JOIN consent_by_subject c
                    ON c.subject_id = t.subject_id
                ORDER BY t.day DESC, t.subject_id
                LIMIT 500
            `;

            const pullTrendParams = [missingSubjectIds, projectId];
            const pullTrendResult = await connection.query(pullTrendQuery, pullTrendParams);
            pullTrendBySubject = (pullTrendResult.rows as TrendRow[]).map((row) => ({
                subject_id: row.subject_id,
                day: row.day,
                pulls_with_unique_file_md5: parseCount(row.pulls_with_unique_file_md5),
                is_consent_date: Boolean(row.is_consent_date),
            }));

            const pullTrendByModalityQuery = `
                WITH consent_by_subject AS (
                    SELECT
                        subject_id,
                        CASE
                            WHEN NULLIF(subject_metadata->>'consent_date', '') ~ '^\\d{4}-\\d{2}-\\d{2}$'
                                THEN NULLIF(subject_metadata->>'consent_date', '')::date
                            WHEN NULLIF(subject_metadata->>'consent_date', '') ~ '^\\d{4}-\\d{2}-\\d{2}[ T].*$'
                                THEN NULLIF(subject_metadata->>'consent_date', '')::timestamptz::date
                            WHEN NULLIF(subject_metadata->>'consent_date', '') ~ '^\\d{1,2}/\\d{1,2}/\\d{4}$'
                                THEN to_date(NULLIF(subject_metadata->>'consent_date', ''), 'MM/DD/YYYY')
                            ELSE NULL
                        END AS consent_date
                    FROM public.subjects
                    WHERE project_id = $2
                      AND subject_id = ANY($1::text[])
                ),
                trend_by_subject_modality AS (
                    ${hasFileMd5Column ? `
                    WITH first_seen_md5_by_modality AS (
                        SELECT
                            subject_id,
                            CASE
                                WHEN LOWER(COALESCE(${pullSourceSelect}, '')) LIKE '%mindlamp_qc%'
                                    OR LOWER(COALESCE(${pullSourceSelect}, '')) LIKE '%mindlampqc%'
                                    THEN 'mindlamp_qc_sharepoint'
                                WHEN LOWER(COALESCE(${pullSourceSelect}, '')) LIKE '%upenn_recap%'
                                    OR LOWER(COALESCE(${pullSourceSelect}, '')) LIKE '%upenn_redcap%'
                                    OR LOWER(COALESCE(${pullSourceSelect}, '')) LIKE '%penncnb%'
                                    THEN 'penncnb'
                                WHEN LOWER(COALESCE(${pullSourceSelect}, '')) LIKE '%redcap%'
                                    THEN 'redcap'
                                WHEN LOWER(COALESCE(${pullSourceSelect}, '')) LIKE '%eeg%'
                                    THEN 'eeg_sharepoint'
                                WHEN LOWER(COALESCE(${pullSourceSelect}, '')) LIKE '%mindlamp%'
                                    THEN 'mindlamp'
                                WHEN LOWER(COALESCE(${pullSourceSelect}, '')) LIKE '%cantab%'
                                    THEN 'cantab'
                                WHEN LOWER(COALESCE(${pullSourceSelect}, '')) LIKE '%transcript%'
                                    OR LOWER(COALESCE(${pullSourceSelect}, '')) LIKE '%transcripts%'
                                    THEN 'transcript_sharepoint'
                                ELSE NULL
                            END AS modality_key,
                            MIN(date_trunc('day', ${quoteIdentifier(pullTimestampColumn)}::timestamptz)::date) AS day,
                            NULLIF(file_md5::text, '') AS file_md5
                        FROM ${dataPullTableSql}
                        WHERE subject_id = ANY($1::text[])
                          ${hasDataPullProjectColumn ? "AND project_id = $2" : ""}
                          AND ${quoteIdentifier(pullTimestampColumn)} IS NOT NULL
                          AND COALESCE(file_md5::text, '') <> ''
                        GROUP BY subject_id, modality_key, NULLIF(file_md5::text, '')
                    )
                    SELECT
                        subject_id,
                        modality_key,
                        day,
                        COUNT(*)::int AS pulls_with_unique_file_md5
                    FROM first_seen_md5_by_modality
                    GROUP BY subject_id, modality_key, day
                    ` : `
                    SELECT
                        subject_id,
                        CASE
                            WHEN LOWER(COALESCE(${pullSourceSelect}, '')) LIKE '%mindlamp_qc%'
                                OR LOWER(COALESCE(${pullSourceSelect}, '')) LIKE '%mindlampqc%'
                                THEN 'mindlamp_qc_sharepoint'
                            WHEN LOWER(COALESCE(${pullSourceSelect}, '')) LIKE '%upenn_recap%'
                                OR LOWER(COALESCE(${pullSourceSelect}, '')) LIKE '%upenn_redcap%'
                                OR LOWER(COALESCE(${pullSourceSelect}, '')) LIKE '%penncnb%'
                                THEN 'penncnb'
                            WHEN LOWER(COALESCE(${pullSourceSelect}, '')) LIKE '%redcap%'
                                THEN 'redcap'
                            WHEN LOWER(COALESCE(${pullSourceSelect}, '')) LIKE '%eeg%'
                                THEN 'eeg_sharepoint'
                            WHEN LOWER(COALESCE(${pullSourceSelect}, '')) LIKE '%mindlamp%'
                                THEN 'mindlamp'
                            WHEN LOWER(COALESCE(${pullSourceSelect}, '')) LIKE '%cantab%'
                                THEN 'cantab'
                            WHEN LOWER(COALESCE(${pullSourceSelect}, '')) LIKE '%transcript%'
                                OR LOWER(COALESCE(${pullSourceSelect}, '')) LIKE '%transcripts%'
                                THEN 'transcript_sharepoint'
                            ELSE NULL
                        END AS modality_key,
                        date_trunc('day', ${quoteIdentifier(pullTimestampColumn)}::timestamptz)::date AS day,
                        COUNT(*)::int AS pulls_with_unique_file_md5
                    FROM ${dataPullTableSql}
                    WHERE subject_id = ANY($1::text[])
                      ${hasDataPullProjectColumn ? "AND project_id = $2" : ""}
                      AND ${quoteIdentifier(pullTimestampColumn)} IS NOT NULL
                    GROUP BY subject_id, modality_key, day
                    `}
                )
                SELECT
                    t.subject_id,
                    t.modality_key,
                    t.day,
                    t.pulls_with_unique_file_md5,
                    (c.consent_date IS NOT NULL AND t.day = c.consent_date) AS is_consent_date
                FROM trend_by_subject_modality t
                LEFT JOIN consent_by_subject c
                    ON c.subject_id = t.subject_id
                WHERE t.modality_key IS NOT NULL
                ORDER BY t.day DESC, t.subject_id, t.modality_key
                LIMIT 2500
            `;

            const pullTrendByModalityResult = await connection.query(pullTrendByModalityQuery, pullTrendParams);
            pullTrendBySubjectAndModality = (pullTrendByModalityResult.rows as TrendByModalityRow[]).map((row) => ({
                subject_id: row.subject_id,
                modality_key: row.modality_key,
                day: row.day,
                pulls_with_unique_file_md5: parseCount(row.pulls_with_unique_file_md5),
                is_consent_date: Boolean(row.is_consent_date),
            }));
        }
    }

    if (filesTableSql && filesPathColumn && pullSourceColumn && hasDataPullSubjectColumn && dataPullTableSql) {
        const pullSourceSelect = `${quoteIdentifier(pullSourceColumn)}::text`;
        const joinCondition = hasFileMd5Column && hasFilesFileMd5Column
            ? `NULLIF(p.file_md5::text, '') IS NOT NULL
               AND NULLIF(f.file_md5::text, '') IS NOT NULL
               AND NULLIF(p.file_md5::text, '') = NULLIF(f.file_md5::text, '')`
            : pullFilePathColumn
                ? `NULLIF(p.${quoteIdentifier(pullFilePathColumn)}::text, '') IS NOT NULL
                   AND NULLIF(f.${quoteIdentifier(filesPathColumn)}::text, '') IS NOT NULL
                   AND NULLIF(p.${quoteIdentifier(pullFilePathColumn)}::text, '') = NULLIF(f.${quoteIdentifier(filesPathColumn)}::text, '')`
                : null;

        if (joinCondition) {
        const filePathCountsQuery = `
            SELECT
                p.subject_id,
                ${pullSourceSelect} AS data_source_name,
                COUNT(DISTINCT NULLIF(f.${quoteIdentifier(filesPathColumn)}::text, ''))::int AS unique_file_paths
            FROM ${dataPullTableSql} p
            INNER JOIN ${filesTableSql} f
                ON ${joinCondition}
            WHERE p.subject_id = ANY($1::text[])
              ${hasDataPullProjectColumn ? "AND p.project_id = $2" : ""}
              ${hasFilesProjectColumn ? `AND f.project_id = ${hasDataPullProjectColumn ? "$2" : "$2"}` : ""}
            GROUP BY p.subject_id, ${pullSourceSelect}
            ORDER BY p.subject_id, ${pullSourceSelect}
        `;

        const filePathCountsParams = hasDataPullProjectColumn || hasFilesProjectColumn
            ? [missingSubjectIds, projectId]
            : [missingSubjectIds];
        const filePathCountsResult = await connection.query(filePathCountsQuery, filePathCountsParams);
        uniqueFilePathsByDataSource = (filePathCountsResult.rows as FilePathCountRow[]).map((row) => ({
            subject_id: row.subject_id,
            data_source_name: row.data_source_name,
            unique_file_paths: parseCount(row.unique_file_paths),
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
        consent_dates_by_subject: consentDatesBySubject,
        unique_file_paths_by_data_source: uniqueFilePathsByDataSource,
        data_pull_coverage_by_subject: coverageBySubject,
        data_pull_trend_by_subject: pullTrendBySubject,
        data_pull_trend_by_subject_and_modality: pullTrendBySubjectAndModality,
        last_warning_logs: lastWarnings,
        metadata: {
            notes: {
                pull_timestamp_column: pullTimestampColumn,
                pull_source_column: pullSourceColumn,
                file_md5_available: hasFileMd5Column,
                data_pulls_available: hasDataPullSubjectColumn,
                data_pull_table: dataPullTable,
                data_pulls_columns: [...dataPullColumns],
                files_available: Boolean(filesTableSql && filesSourceColumn && filesPathColumn),
                files_table: filesTable,
                files_source_column: filesSourceColumn,
                files_path_column: filesPathColumn,
                files_scoped_by_project: hasFilesProjectColumn,
            },
        },
    };

    return new Response(JSON.stringify(response), {
        headers: {
            "Content-Type": "application/json",
        },
    });
}
