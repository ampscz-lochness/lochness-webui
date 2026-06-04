import { getConnection } from "@/lib/db";
import { getFormsConnection } from "@/lib/formsdb";
import { getStatusFlagsBySubject } from "@/lib/models/forms-status";
import type { Pool } from "pg";
import type {
    SharePointPayload,
    SharePointSubject,
    SharePointActivityRow,
    RunSheetRecord,
} from "@/types/sharepoint-tracker";

type TableName = "subjects" | "data_pulls" | "data_pull";

type ConsentSubjectRow = {
    subject_id: string;
    site_id: string;
    consent_date: string | null;
    is_consented: boolean;
};

type SpActivityRow = {
    subject_id: string;
    modality_key: string;
    file_type: "json" | "actual";
    calendar_date: string;
    day_offset: string;
    unique_file_count: string;
    file_paths: string[] | null;
};

type RunSheetRow = {
    subject_id: string;
    form_name: string;
    form_instance_number: number | null;
    redcap_event_name: string | null;
    has_data: boolean;
    form_data: Record<string, unknown> | null;
};

type DataSourceRequirementRow = {
    data_source_name: string;
    data_source_type: string | null;
    data_source_metadata: Record<string, unknown> | string | null;
};

// ── Column detection helpers ──────────────────────────────────────────────────

async function getColumns(tableName: TableName): Promise<Set<string>> {
    const connection = getConnection();
    const result = await connection.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1`,
        [tableName]
    );
    return new Set(result.rows.map((row: { column_name: string }) => row.column_name));
}

async function getFirstExistingTable(tableNames: TableName[]): Promise<TableName | null> {
    const connection = getConnection();
    const result = await connection.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
        [tableNames]
    );
    const existing = new Set(result.rows.map((row: { table_name: string }) => row.table_name));
    for (const candidate of tableNames) {
        if (existing.has(candidate)) return candidate;
    }
    return null;
}

function pickFirstColumn(columns: Set<string>, candidates: string[]): string | null {
    for (const candidate of candidates) {
        if (columns.has(candidate)) return candidate;
    }
    return null;
}

function quoteIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`;
}

function parseCount(value: string | number | null | undefined): number {
    if (typeof value === "number") return value;
    if (!value) return 0;
    const parsed = parseInt(value, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
}

async function queryWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return await new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Query timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        promise
            .then((value) => {
                clearTimeout(timer);
                resolve(value);
            })
            .catch((error) => {
                clearTimeout(timer);
                reject(error);
            });
    });
}

function parseBooleanLike(value: unknown): boolean | null {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") {
        if (value === 1) return true;
        if (value === 0) return false;
    }
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (["1", "true", "yes", "y", "required"].includes(normalized)) return true;
        if (["0", "false", "no", "n", "optional", "not_required", "not required"].includes(normalized)) return false;
    }
    return null;
}

function getValueAtPath(input: unknown, path: string): unknown {
    let current: unknown = input;
    for (const key of path.split(".")) {
        if (!current || typeof current !== "object") return null;
        current = (current as Record<string, unknown>)[key];
    }
    return current;
}

function coerceMetadataObject(metadata: unknown): Record<string, unknown> | null {
    if (!metadata) return null;
    if (typeof metadata === "object") return metadata as Record<string, unknown>;
    if (typeof metadata === "string") {
        try {
            const parsed = JSON.parse(metadata);
            if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
        } catch {
            return null;
        }
    }
    return null;
}

function toStringIfPresent(value: unknown): string {
    if (typeof value !== "string") return "";
    const trimmed = value.trim();
    return trimmed;
}

function extractJsonRequiredFromMetadata(metadata: Record<string, unknown> | null): boolean | null {
    if (!metadata) return null;

    const directKeys = [
        "json_required",
        "require_json",
        "requires_json",
        "json_file_required",
        "requires_json_file",
        "expect_json",
        "expects_json",
    ];

    for (const key of directKeys) {
        const parsed = parseBooleanLike(getValueAtPath(metadata, key));
        if (parsed !== null) return parsed;
    }

    const nestedKeys = [
        "sharepoint.json_required",
        "sharepoint.require_json",
        "sharepoint.requires_json",
        "qc.json_required",
        "qc.require_json",
    ];

    for (const path of nestedKeys) {
        const parsed = parseBooleanLike(getValueAtPath(metadata, path));
        if (parsed !== null) return parsed;
    }

    const inverseKeys = [
        "json_not_required",
        "json_optional",
        "skip_json",
        "without_form",
        "potential_file_uploads_without_form_update",
    ];
    for (const key of inverseKeys) {
        const parsed = parseBooleanLike(getValueAtPath(metadata, key));
        if (parsed !== null) return !parsed;
    }

    return null;
}

function dataSourceToSpModality(row: DataSourceRequirementRow): string | null {
    const metadata = coerceMetadataObject(row.data_source_metadata);
    const label = [
        row.data_source_name,
        row.data_source_type ?? "",
        toStringIfPresent(getValueAtPath(metadata, "modality")),
        toStringIfPresent(getValueAtPath(metadata, "form_name")),
        toStringIfPresent(getValueAtPath(metadata, "form_title")),
        toStringIfPresent(getValueAtPath(metadata, "drive_name")),
        toStringIfPresent(getValueAtPath(metadata, "date_str")),
    ]
        .filter(Boolean)
        .join(" ");

    return formNameToModality(label);
}

function mergeJsonRequirement(existing: boolean | null, next: boolean | null): boolean | null {
    if (next === null) return existing;
    if (existing === null) return next;
    if (existing === false || next === false) return false;
    if (existing === true || next === true) return true;
    return null;
}

// ── SharePoint-only modality CASE statement ───────────────────────────────────
// Excludes REDCap, MindLAMP (non-QC), PennCNB, CANTAB — only the three SharePoint modalities.

const SP_MODALITY_CASE = (pullSourceSelect: string) => `
    CASE
        WHEN LOWER(COALESCE(${pullSourceSelect}, '')) LIKE '%mindlamp_qc%'
            OR LOWER(COALESCE(${pullSourceSelect}, '')) LIKE '%mindlampqc%'
            THEN 'mindlamp_qc_sharepoint'
        WHEN LOWER(COALESCE(${pullSourceSelect}, '')) LIKE '%eeg%'
            THEN 'eeg_sharepoint'
        WHEN LOWER(COALESCE(${pullSourceSelect}, '')) LIKE '%transcript%'
            OR LOWER(COALESCE(${pullSourceSelect}, '')) LIKE '%transcripts%'
            THEN 'transcript_sharepoint'
        ELSE NULL
    END
`;

// ── Run sheet form → modality mapping ────────────────────────────────────────

export function formNameToModality(formName: string): string | null {
    const lower = formName.toLowerCase();
    if (lower.includes("mindlamp_qc") || lower.includes("mindlampqc")) return "mindlamp_qc_sharepoint";
    if (lower.includes("eeg")) return "eeg_sharepoint";
    if (lower.includes("transcript")) return "transcript_sharepoint";
    // Generic mindlamp (after QC check above) → MindLAMP QC sharepoint bucket
    if (lower.includes("mindlamp")) return "mindlamp_qc_sharepoint";
    return null;
}

// ── Consent date normalisation (same as daytracker) ──────────────────────────

const CONSENT_DATE_CASE = `
    CASE
        WHEN NULLIF(subject_metadata->>'consent_date', '') ~ '^\\d{4}-\\d{2}-\\d{2}$'
            THEN NULLIF(subject_metadata->>'consent_date', '')::date
        WHEN NULLIF(subject_metadata->>'consent_date', '') ~ '^\\d{4}-\\d{2}-\\d{2}[ T].*$'
            THEN NULLIF(subject_metadata->>'consent_date', '')::timestamptz::date
        WHEN NULLIF(subject_metadata->>'consent_date', '') ~ '^\\d{1,2}/\\d{1,2}/\\d{4}$'
            THEN to_date(NULLIF(subject_metadata->>'consent_date', ''), 'MM/DD/YYYY')
        ELSE NULL
    END
`;

// ── Error class ───────────────────────────────────────────────────────────────
// ── Schema detection cache ────────────────────────────────────────────────────
// information_schema queries run on every request but the schema almost never
// changes.  Cache results for 5 minutes so warm requests skip these round-trips.
let _schemaCacheValue: {
    dataPullTable: TableName | null;
    subjectColumns: Set<string>;
    dataPullColumns: Set<string>;
} | null = null;
let _schemaCachedAt = 0;
const SCHEMA_CACHE_TTL_MS = 5 * 60 * 1000;

async function getCachedSchema(): Promise<{
    dataPullTable: TableName | null;
    subjectColumns: Set<string>;
    dataPullColumns: Set<string>;
}> {
    if (_schemaCacheValue && Date.now() - _schemaCachedAt < SCHEMA_CACHE_TTL_MS) {
        return _schemaCacheValue;
    }
    const dataPullTable = await getFirstExistingTable(["data_pulls", "data_pull"]);
    const [subjectColumns, dataPullColumns] = await Promise.all([
        getColumns("subjects"),
        dataPullTable ? getColumns(dataPullTable) : Promise.resolve(new Set<string>()),
    ]);
    _schemaCacheValue = { dataPullTable, subjectColumns, dataPullColumns };
    _schemaCachedAt = Date.now();
    return _schemaCacheValue;
}

// ── Error class ───────────────────────────────────────────────────────────────

export class SharePointTrackerModelError extends Error {
    constructor(
        message: string,
        public readonly status: number,
        public readonly details?: Record<string, unknown>
    ) {
        super(message);
        this.name = "SharePointTrackerModelError";
    }
}

// ── Model ─────────────────────────────────────────────────────────────────────

export class SharePointTracker {
    static async getProjectSharePointTracker(projectId: string): Promise<SharePointPayload> {
        const connection = getConnection();

        // ── Phase 1: parallel setup (schema cache + formsdb probe + data_sources) ──
        const phase1 = await Promise.all([
            getCachedSchema(),
            // formsdb probe
            (async (): Promise<Pool | null> => {
                try {
                    const conn = getFormsConnection();
                    await queryWithTimeout(conn.query("SELECT 1"), 1500);
                    return conn;
                } catch {
                    return null;
                }
            })(),
            connection
                .query(
                    `SELECT data_source_name, data_source_type, data_source_metadata
                     FROM public.data_sources
                     WHERE project_id = $1
                       AND COALESCE(data_source_is_active, true) = true`,
                    [projectId]
                )
                .catch((): { rows: DataSourceRequirementRow[] } => ({ rows: [] })),
        ]);

        const { dataPullTable, subjectColumns, dataPullColumns } = phase1[0];
            const formsConn = phase1[1] as Pool | null;
            const formsDbAvailable = formsConn !== null;
        const jsonRequiredByModality: Record<string, boolean | null> = {
            eeg_sharepoint: null,
            mindlamp_qc_sharepoint: null,
            transcript_sharepoint: null,
        };
        for (const row of (phase1[2] as { rows: DataSourceRequirementRow[] }).rows) {
            const modality = dataSourceToSpModality(row);
            if (!modality) continue;
            const jsonRequired = extractJsonRequiredFromMetadata(coerceMetadataObject(row.data_source_metadata));
            jsonRequiredByModality[modality] = mergeJsonRequirement(
                jsonRequiredByModality[modality] ?? null,
                jsonRequired
            );
        }

        if (
            !subjectColumns.has("project_id") ||
            !subjectColumns.has("subject_id") ||
            !subjectColumns.has("site_id") ||
            !subjectColumns.has("subject_metadata")
        ) {
            throw new SharePointTrackerModelError(
                "subjects table is missing required columns",
                500,
                { required: ["project_id", "subject_id", "site_id", "subject_metadata"] }
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
        const pullFilePathColumn = pickFirstColumn(dataPullColumns, ["file_path", "filepath", "path"]);
        const hasFileMd5Column = dataPullColumns.has("file_md5");
        const hasPullMetadataColumn = dataPullColumns.has("pull_metadata");

        // ── 1. Subjects ───────────────────────────────────────────────────────
        const consentResult = await connection.query(
            `SELECT
                subject_id,
                site_id,
                NULLIF(subject_metadata->>'consent_date', '')::text AS consent_date,
                (COALESCE(subject_metadata->>'missing_required_variables', 'NOT_EMPTY') = '') AS is_consented
             FROM public.subjects
             WHERE project_id = $1
               AND COALESCE(subject_metadata->>'missing_required_variables', 'NOT_EMPTY') = ''
                             AND NULLIF(subject_metadata->>'consent_date', '') IS NOT NULL
             ORDER BY site_id, subject_id`,
            [projectId]
        );
        const consentSubjects = consentResult.rows as ConsentSubjectRow[];
        const subjectIds = consentSubjects.map((r) => r.subject_id);

        // ── 2. Consent date lookup (built from already-fetched subjects) ─────────
        const consentDateBySubject = new Map<string, string>();
        for (const r of consentSubjects) {
            if (r.consent_date) consentDateBySubject.set(r.subject_id, r.consent_date);
        }

        // ── Early return when data_pulls unavailable (statusFlags fetched here only) ──
        if (
            subjectIds.length === 0 ||
            !hasDataPullSubjectColumn ||
            !dataPullTableSql ||
            !pullTimestampColumn
        ) {
            let sfMap = new Map<string, { is_screen_failed: boolean; is_withdrawn: boolean; screen_fail_reason: string | null; screen_fail_comments: string | null }>();
            if (formsDbAvailable && subjectIds.length > 0) {
                try { sfMap = await queryWithTimeout(getStatusFlagsBySubject(projectId, subjectIds), 3000); } catch { /* ignore */ }
            }
            return {
                project_id: projectId,
                subjects: consentSubjects.map((r) => ({
                    subject_id: r.subject_id,
                    site_id: r.site_id,
                    consent_date: r.consent_date,
                    is_consented: r.is_consented,
                    is_screen_failed: sfMap.get(r.subject_id)?.is_screen_failed ?? false,
                    is_withdrawn: sfMap.get(r.subject_id)?.is_withdrawn ?? false,
                    screen_fail_reason: sfMap.get(r.subject_id)?.screen_fail_reason ?? null,
                    screen_fail_comments: sfMap.get(r.subject_id)?.screen_fail_comments ?? null,
                    days: [],
                    run_sheets: [],
                    eeg_file_count: 0,
                    eeg_json_count: 0,
                    eeg_run_sheet_count: 0,
                    eeg_count_mismatch: false,
                })),
                modality_keys: [],
                run_sheet_forms: [],
                run_sheet_form_to_modality: {},
                metadata: {
                    data_pulls_available: false,
                    file_md5_available: hasFileMd5Column,
                    json_required_by_modality: jsonRequiredByModality,
                    day_offset_range: null,
                },
            };
        }

        const pullSourceSelect = pullSourceColumn
            ? `${quoteIdentifier(pullSourceColumn)}::text`
            : "NULL::text";

        const filePathSelect = pullFilePathColumn
            ? `NULLIF(${quoteIdentifier(pullFilePathColumn)}::text, '')`
            : "NULL::text";

        const subjectsWithConsentDate = consentSubjects
            .filter((r) => r.consent_date !== null)
            .map((r) => r.subject_id);

        // ── Build Phase 3 query strings ───────────────────────────────────────
        const activityQuery = subjectsWithConsentDate.length > 0
            ? (hasFileMd5Column
                ? `
                    WITH consent_by_subject AS (
                        SELECT subject_id, ${CONSENT_DATE_CASE} AS consent_date
                        FROM public.subjects
                        WHERE project_id = $2 AND subject_id = ANY($1::text[])
                    ),
                    classified AS (
                        SELECT p.subject_id, ${SP_MODALITY_CASE(pullSourceSelect)} AS modality_key,
                               CASE WHEN LOWER(COALESCE(${filePathSelect}, '')) LIKE '%.json' THEN 'json' ELSE 'actual' END AS file_type,
                               date_trunc('day', p.${quoteIdentifier(pullTimestampColumn)}::timestamptz)::date AS calendar_date,
                               p.${quoteIdentifier(pullTimestampColumn)}::timestamptz AS pull_ts,
                               NULLIF(p.file_md5::text, '') AS file_md5, ${filePathSelect} AS file_path
                        FROM ${dataPullTableSql} p
                        WHERE p.subject_id = ANY($1::text[])
                          ${hasDataPullProjectColumn ? "AND p.project_id = $2" : ""}
                          AND NULLIF(p.file_md5::text, '') IS NOT NULL
                          AND p.${quoteIdentifier(pullTimestampColumn)} IS NOT NULL
                    ),
                    deduped AS (
                        SELECT DISTINCT ON (subject_id, modality_key, file_type, file_md5)
                               subject_id, modality_key, file_type, calendar_date, pull_ts, file_path
                        FROM classified
                        WHERE modality_key IS NOT NULL AND file_md5 IS NOT NULL
                        ORDER BY subject_id, modality_key, file_type, file_md5, pull_ts ASC NULLS LAST
                    )
                    SELECT d.subject_id, d.modality_key, d.file_type,
                           d.calendar_date::text AS calendar_date,
                           (d.calendar_date - c.consent_date)::int AS day_offset,
                           COUNT(*)::int AS unique_file_count,
                           COALESCE(array_agg(d.file_path ORDER BY d.pull_ts DESC NULLS LAST) FILTER (WHERE d.file_path IS NOT NULL), ARRAY[]::text[]) AS file_paths
                    FROM deduped d JOIN consent_by_subject c USING (subject_id)
                    WHERE c.consent_date IS NOT NULL
                    GROUP BY d.subject_id, d.modality_key, d.file_type, d.calendar_date, c.consent_date
                    ORDER BY d.subject_id, day_offset, d.modality_key, d.file_type LIMIT 10000`
                : `
                    WITH consent_by_subject AS (
                        SELECT subject_id, ${CONSENT_DATE_CASE} AS consent_date
                        FROM public.subjects
                        WHERE project_id = $2 AND subject_id = ANY($1::text[])
                    ),
                    classified AS (
                        SELECT p.subject_id, ${SP_MODALITY_CASE(pullSourceSelect)} AS modality_key,
                               CASE WHEN LOWER(COALESCE(${filePathSelect}, '')) LIKE '%.json' THEN 'json' ELSE 'actual' END AS file_type,
                               date_trunc('day', p.${quoteIdentifier(pullTimestampColumn)}::timestamptz)::date AS calendar_date,
                               p.${quoteIdentifier(pullTimestampColumn)}::timestamptz AS pull_ts, ${filePathSelect} AS file_path
                        FROM ${dataPullTableSql} p
                        WHERE p.subject_id = ANY($1::text[])
                          ${hasDataPullProjectColumn ? "AND p.project_id = $2" : ""}
                          AND p.${quoteIdentifier(pullTimestampColumn)} IS NOT NULL
                    )
                    SELECT c2.subject_id, c2.modality_key, c2.file_type,
                           c2.calendar_date::text AS calendar_date,
                           (c2.calendar_date - cs.consent_date)::int AS day_offset,
                           COUNT(*)::int AS unique_file_count,
                           COALESCE(array_agg(c2.file_path ORDER BY c2.pull_ts DESC NULLS LAST) FILTER (WHERE c2.file_path IS NOT NULL), ARRAY[]::text[]) AS file_paths
                    FROM classified c2 JOIN consent_by_subject cs USING (subject_id)
                    WHERE c2.modality_key IS NOT NULL AND cs.consent_date IS NOT NULL
                    GROUP BY c2.subject_id, c2.modality_key, c2.file_type, c2.calendar_date, cs.consent_date
                    ORDER BY c2.subject_id, day_offset, c2.modality_key, c2.file_type LIMIT 10000`)
            : null;

        // Merged run-sheets query: discover + records in one round-trip.
        // form_event_name is the dedicated column (no JSON extraction needed).
        // consent_date is looked up in JS from consentDateBySubject — no JOIN required.
        const runSheetsQuery = `
            SELECT rf.subject_id, rf.form_name, rf.form_instance_number,
                   COALESCE(
                       NULLIF(rf.form_event_name, ''),
                       NULLIF(rf.form_data->>'redcap_event_name', ''),
                       NULLIF(rf.form_data->>'event_name', '')
                   ) AS redcap_event_name,
                   rf.form_data,
                   (
                       rf.form_data IS NOT NULL AND rf.form_data::text <> '{}' AND rf.form_data::text <> 'null'
                       AND (
                           rf.form_data->>(rf.form_name || '_complete') = '2'
                           OR EXISTS (SELECT 1 FROM jsonb_each_text(rf.form_data) kv WHERE kv.key LIKE '%_performed' AND kv.value = '1')
                           OR COALESCE(LOWER(rf.form_data->>'data_acquired'), '') IN ('yes', 'true', '1', 'y')
                           OR COALESCE(LOWER(rf.form_data->>'session_completed'), '') IN ('yes', 'true', '1', 'y')
                           OR COALESCE(LOWER(rf.form_data->>'session_data_acquired'), '') IN ('yes', 'true', '1', 'y')
                           OR COALESCE(LOWER(rf.form_data->>'acquisition_complete'), '') IN ('yes', 'true', '1', 'y')
                           OR COALESCE(LOWER(rf.form_data->>'eeg_data_collected'), '') IN ('yes', 'true', '1', 'y')
                           OR COALESCE(LOWER(rf.form_data->>'eeg_acquired'), '') IN ('yes', 'true', '1', 'y')
                           OR COALESCE(LOWER(rf.form_data->>'checkin_complete'), '') IN ('yes', 'true', '1', 'y')
                           OR COALESCE(LOWER(rf.form_data->>'data_collected'), '') IN ('yes', 'true', '1', 'y')
                           OR COALESCE(LOWER(rf.form_data->>'recording_complete'), '') IN ('yes', 'true', '1', 'y')
                           OR COALESCE(LOWER(rf.form_data->>'transcript_acquired'), '') IN ('yes', 'true', '1', 'y')
                           OR EXISTS (SELECT 1 FROM jsonb_each_text(rf.form_data) kv WHERE kv.key LIKE '%_complete' AND kv.value = '2')
                       )
                   ) AS has_data
            FROM forms.redcap_forms rf
            WHERE rf.subject_id = ANY($1::text[])
              AND (
                  LOWER(rf.form_name) LIKE '%eeg%'
               OR LOWER(rf.form_name) LIKE '%transcript%'
               OR LOWER(rf.form_name) LIKE '%mindlamp%'
               OR LOWER(rf.form_name) LIKE '%run_sheet%'
               OR LOWER(rf.form_name) LIKE '%runsheet%'
               OR LOWER(rf.form_name) LIKE '%sharepoint%'
              )
            ORDER BY rf.subject_id, rf.form_name, COALESCE(rf.form_instance_number, 0)`;

        const day1aQuery = (dataPullTable && hasPullMetadataColumn)
            ? `SELECT dp.subject_id, MIN((dp.pull_timestamp::date)::text) AS day1a_date
               FROM ${quoteIdentifier(dataPullTable)} dp
               WHERE dp.subject_id = ANY($1::text[])
                 AND dp.pull_metadata->>'event_name' ILIKE '%day_1a%predose%'
               GROUP BY dp.subject_id`
            : null;

        const readyFormsConn: Pool | null =
            formsDbAvailable && formsConn ? formsConn : null;

        // ── Phase 3: fire all independent queries in parallel ─────────────────
        const [activitySettled, statusFlagsSettled, runSheetsSettled, spFormSettled, day1aSettled] =
            await Promise.allSettled([
                activityQuery
                    ? connection.query(activityQuery, [subjectsWithConsentDate, projectId])
                    : Promise.resolve({ rows: [] }),
                formsDbAvailable
                    ? queryWithTimeout(getStatusFlagsBySubject(projectId, subjectIds), 3000)
                    : Promise.resolve(new Map<string, { is_screen_failed: boolean; is_withdrawn: boolean; screen_fail_reason: string | null; screen_fail_comments: string | null }>()),
                readyFormsConn
                    ? queryWithTimeout(readyFormsConn.query(runSheetsQuery, [subjectIds]), 10000)
                    : Promise.resolve({ rows: [] }),
                readyFormsConn
                    ? queryWithTimeout(
                          readyFormsConn.query(
                              `SELECT subject_id, (form_data->>'event_date')::date::text AS event_date
                               FROM sharepoint.sharepoint_forms
                               WHERE subject_id = ANY($1::text[])
                                 AND form_data->>'event_date' IS NOT NULL`,
                              [subjectIds]
                          ),
                          5000
                      )
                    : Promise.resolve({ rows: [] }),
                day1aQuery
                    ? connection.query(day1aQuery, [subjectIds])
                    : Promise.resolve({ rows: [] }),
            ]);

        // ── Process activity results ──────────────────────────────────────────
        const daysBySubject = new Map<string, SharePointActivityRow[]>();
        if (activitySettled.status === "fulfilled") {
            for (const row of activitySettled.value.rows as SpActivityRow[]) {
                if (!daysBySubject.has(row.subject_id)) daysBySubject.set(row.subject_id, []);
                daysBySubject.get(row.subject_id)!.push({
                    day_offset: parseCount(row.day_offset),
                    calendar_date: row.calendar_date,
                    modality_key: row.modality_key,
                    file_type: row.file_type,
                    unique_file_count: parseCount(row.unique_file_count),
                    file_paths: row.file_paths ?? [],
                });
            }
        }

        // ── Process status flags ──────────────────────────────────────────────
        const statusFlagsBySubject =
            statusFlagsSettled.status === "fulfilled"
                ? statusFlagsSettled.value
                : new Map<string, { is_screen_failed: boolean; is_withdrawn: boolean; screen_fail_reason: string | null; screen_fail_comments: string | null }>();

        // ── Process run sheets (merged discover+records result) ───────────────
        let runSheetForms: string[] = [];
        const runSheetsBySubject = new Map<string, RunSheetRecord[]>();

        if (runSheetsSettled.status === "fulfilled") {
            // Helpers (defined here, used below)
            const extractFormTimestamp = (form: Record<string, unknown> | null, formName: string): string | null => {
                if (!form) return null;
                for (const [key, val] of Object.entries(form)) {
                    if (key.endsWith('_interview_date') && val && typeof val === 'string') {
                        const trimmed = val.trim();
                        if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
                    }
                }
                const ts = form[`${formName}_timestamp`] as string | undefined;
                if (ts && typeof ts === 'string' && ts.trim()) return ts.trim().split('T')[0];
                const genericTs = form['timestamp'] as string | undefined;
                if (genericTs && typeof genericTs === 'string' && genericTs.trim()) return genericTs.trim().split('T')[0];
                return null;
            };

            const extractRunSheetFieldSummary = (form: Record<string, unknown> | null, formName: string): Record<string, string> => {
                const summary: Record<string, string> = {};
                if (!form) return summary;
                const completionVal = form[`${formName}_complete`];
                if (completionVal != null) summary['completion'] = String(completionVal).trim();
                for (const [key, val] of Object.entries(form)) {
                    if (key.endsWith('_interview_date') && val && typeof val === 'string') {
                        const trimmed = val.trim();
                        if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) { summary['session_date'] = trimmed; break; }
                    }
                }
                for (const [key, val] of Object.entries(form)) {
                    if (key.endsWith('_performed') && val != null) { summary['performed'] = String(val).trim(); break; }
                }
                for (const [key, val] of Object.entries(form)) {
                    if (key.endsWith('_redcap_user') && val && typeof val === 'string' && val.trim()) { summary['redcap_user'] = val.trim(); break; }
                }
                for (const [key, val] of Object.entries(form)) {
                    if (key.endsWith('_primaryperson') && val && typeof val === 'string' && val.trim()) { summary['technician'] = val.trim(); break; }
                }
                for (const [key, val] of Object.entries(form)) {
                    if (key.endsWith('_start') && val && typeof val === 'string' && val.trim()) { summary['start_time'] = val.trim(); break; }
                }
                for (const [key, val] of Object.entries(form)) {
                    if (key.endsWith('_end') && val && typeof val === 'string' && val.trim()) { summary['end_time'] = val.trim(); break; }
                }
                let runsCompleted = 0; let runsTotal = 0;
                for (const [key, val] of Object.entries(form)) {
                    if (/^chreeg_run\d+$/.test(key)) { runsTotal++; if (String(val).trim() === '1') runsCompleted++; }
                }
                if (runsTotal > 0) summary['runs'] = `${runsCompleted}/${runsTotal}`;
                if (form['chreeg_cap_size'] != null) summary['cap_size'] = String(form['chreeg_cap_size']).trim();
                if (form['chreeg_head_cir'] != null) summary['head_cir'] = String(form['chreeg_head_cir']).trim();
                if (form['chrav_nsi_upload'] != null) summary['nsi_upload'] = String(form['chrav_nsi_upload']).trim();
                if (form['chrav_psychs_upload'] != null) summary['psychs_upload'] = String(form['chrav_psychs_upload']).trim();
                return summary;
            };

            const seenFormNames = new Set<string>();
            for (const row of runSheetsSettled.value.rows as RunSheetRow[]) {
                seenFormNames.add(row.form_name);
                if (!runSheetsBySubject.has(row.subject_id)) runSheetsBySubject.set(row.subject_id, []);
                const consentDate = consentDateBySubject.get(row.subject_id) ?? null;
                let dayOffset: number | null = null;
                let completionDate: string | null = null;
                const formTimestamp = extractFormTimestamp(row.form_data, row.form_name);
                if (formTimestamp && consentDate) {
                    completionDate = formTimestamp;
                    try {
                        dayOffset = Math.floor(
                            (new Date(formTimestamp).getTime() - new Date(consentDate).getTime()) / (1000 * 60 * 60 * 24)
                        );
                    } catch { /* keep null */ }
                }
                runSheetsBySubject.get(row.subject_id)!.push({
                    form_name: row.form_name,
                    form_instance_number: row.form_instance_number,
                    redcap_event_name: row.redcap_event_name,
                    has_data: Boolean(row.has_data),
                    completion_date: completionDate,
                    day_offset: dayOffset,
                    form_data_summary: extractRunSheetFieldSummary(row.form_data, row.form_name),
                });
            }
            runSheetForms = [...seenFormNames].sort();

            // Fallback event-name fill from data_pulls metadata only when needed.
            // This keeps the fast path lean while still restoring REDCap Event display
            // for projects where form_event_name is not populated in forms.redcap_forms.
            const needsEventFill = [...runSheetsBySubject.values()].some((rows) =>
                rows.some((rs) => !rs.redcap_event_name)
            );
            if (needsEventFill && dataPullTable && hasPullMetadataColumn && runSheetForms.length > 0) {
                try {
                    const params: unknown[] = [subjectIds, runSheetForms];
                    const projectFilter = hasDataPullProjectColumn ? "AND dp.project_id = $3" : "";
                    if (hasDataPullProjectColumn) params.push(projectId);

                    const eventFillQuery = `
                        SELECT DISTINCT ON (
                            dp.subject_id,
                            dp.pull_metadata->>'form_name',
                            COALESCE((dp.pull_metadata->>'form_instance_number')::int, 0)
                        )
                            dp.subject_id,
                            dp.pull_metadata->>'form_name' AS form_name,
                            COALESCE((dp.pull_metadata->>'form_instance_number')::int, 0) AS form_instance_number,
                            NULLIF(dp.pull_metadata->>'event_name', '') AS event_name
                        FROM ${dataPullTableSql} dp
                        WHERE dp.subject_id = ANY($1::text[])
                          AND dp.pull_metadata->>'form_name' = ANY($2::text[])
                          AND NULLIF(dp.pull_metadata->>'event_name', '') IS NOT NULL
                          ${projectFilter}
                        ORDER BY
                            dp.subject_id,
                            dp.pull_metadata->>'form_name',
                            COALESCE((dp.pull_metadata->>'form_instance_number')::int, 0),
                            dp.${quoteIdentifier(pullTimestampColumn)} DESC NULLS LAST
                    `;

                    const eventFillResult = await connection.query(eventFillQuery, params);
                    const eventNameByKey = new Map<string, string>();
                    for (const row of eventFillResult.rows as { subject_id: string; form_name: string; form_instance_number: number; event_name: string }[]) {
                        const key = `${row.subject_id}|${row.form_name}|${row.form_instance_number}`;
                        if (!eventNameByKey.has(key)) eventNameByKey.set(key, row.event_name);
                    }

                    for (const [subjectId, rows] of runSheetsBySubject) {
                        for (const rs of rows) {
                            if (rs.redcap_event_name) continue;
                            const key = `${subjectId}|${rs.form_name}|${rs.form_instance_number ?? 0}`;
                            const recovered = eventNameByKey.get(key);
                            if (recovered) rs.redcap_event_name = recovered;
                        }
                    }
                } catch {
                    // Non-critical fallback; keep response functional even if query fails.
                }
            }
        }

        // ── Process SharePoint form dates and attach nearest to each run sheet ──
        if (spFormSettled.status === "fulfilled") {
            const spDatesBySubject = new Map<string, string[]>();
            for (const row of spFormSettled.value.rows as { subject_id: string; event_date: string }[]) {
                if (!spDatesBySubject.has(row.subject_id)) spDatesBySubject.set(row.subject_id, []);
                spDatesBySubject.get(row.subject_id)!.push(row.event_date);
            }
            for (const [subjectId, runSheets] of runSheetsBySubject) {
                const spDates = spDatesBySubject.get(subjectId) ?? [];
                if (spDates.length === 0) continue;
                for (const rs of runSheets) {
                    const sessionDate = rs.form_data_summary?.["session_date"] ?? null;
                    if (!sessionDate) continue;
                    let nearest: string | null = null;
                    let nearestDiff = Infinity;
                    for (const spDate of spDates) {
                        try {
                            const diff = Math.abs(new Date(spDate).getTime() - new Date(sessionDate).getTime()) / (1000 * 60 * 60 * 24);
                            if (diff < nearestDiff) { nearestDiff = diff; nearest = spDate; }
                        } catch { /* ignore */ }
                    }
                    if (nearest !== null) rs.form_data_summary = { ...(rs.form_data_summary ?? {}), sp_event_date: nearest };
                }
            }
        }

        // ── Process Day 1a pre-dose dates ─────────────────────────────────────
        const day1aDatesBySubject = new Map<string, string>();
        if (day1aSettled.status === "fulfilled") {
            for (const row of day1aSettled.value.rows as { subject_id: string; day1a_date: string }[]) {
                day1aDatesBySubject.set(row.subject_id, row.day1a_date);
            }
        }

        // ── Build run_sheet_form_to_modality map ──────────────────────────────
        const runSheetFormToModality: Record<string, string> = {};
        for (const form of runSheetForms) {
            const modality = formNameToModality(form);
            if (modality) runSheetFormToModality[form] = modality;
        }

        // ── 6. Assemble per-subject payload ───────────────────────────────────
        const subjects: SharePointSubject[] = consentSubjects.map((row) => {
            const subjectDays = daysBySubject.get(row.subject_id) ?? [];
            const subjectRunSheets = runSheetsBySubject.get(row.subject_id) ?? [];

            const eegFileCount = subjectDays
                .filter((day) => day.modality_key === "eeg_sharepoint" && day.file_type === "actual")
                .reduce((sum, day) => {
                    const zipCount = day.file_paths.filter((path) => {
                        const normalized = path.trim().toLowerCase().split(/[?#]/)[0];
                        return normalized.endsWith(".zip");
                    }).length;
                    return sum + zipCount;
                }, 0);
            const eegJsonCount = subjectDays
                .filter((day) => day.modality_key === "eeg_sharepoint" && day.file_type === "json")
                .reduce((sum, day) => sum + day.unique_file_count, 0);
            const eegRunSheetCount = subjectRunSheets.filter(
                (runSheet) => runSheet.has_data && runSheetFormToModality[runSheet.form_name] === "eeg_sharepoint"
            ).length;
            // JSON count can legitimately diverge across timepoints; only flag mismatches between EEG zip files and run sheets.
            const eegCountMismatch = eegFileCount !== eegRunSheetCount;

            return {
                subject_id: row.subject_id,
                site_id: row.site_id,
                consent_date: row.consent_date,
                is_consented: row.is_consented,
                is_screen_failed: statusFlagsBySubject.get(row.subject_id)?.is_screen_failed ?? false,
                is_withdrawn: statusFlagsBySubject.get(row.subject_id)?.is_withdrawn ?? false,
                screen_fail_reason: statusFlagsBySubject.get(row.subject_id)?.screen_fail_reason ?? null,
                screen_fail_comments: statusFlagsBySubject.get(row.subject_id)?.screen_fail_comments ?? null,
                day1a_predose_date: day1aDatesBySubject.get(row.subject_id) ?? null,
                days: subjectDays,
                run_sheets: subjectRunSheets,
                eeg_file_count: eegFileCount,
                eeg_json_count: eegJsonCount,
                eeg_run_sheet_count: eegRunSheetCount,
                eeg_count_mismatch: eegCountMismatch,
            };
        });

        // ── 7. Collect modality keys present in data ──────────────────────────
        const seenModalities = new Set<string>();
        for (const subject of subjects) {
            for (const day of subject.days) seenModalities.add(day.modality_key);
        }

        // ── 8. Compute day_offset range ───────────────────────────────────────
        let minOffset: number | null = null;
        let maxOffset: number | null = null;
        for (const subject of subjects) {
            for (const day of subject.days) {
                if (minOffset === null || day.day_offset < minOffset) minOffset = day.day_offset;
                if (maxOffset === null || day.day_offset > maxOffset) maxOffset = day.day_offset;
            }
        }

        return {
            project_id: projectId,
            subjects,
            modality_keys: [...seenModalities].sort(),
            run_sheet_forms: runSheetForms,
            run_sheet_form_to_modality: runSheetFormToModality,
            metadata: {
                data_pulls_available: true,
                file_md5_available: hasFileMd5Column,
                json_required_by_modality: jsonRequiredByModality,
                day_offset_range:
                    minOffset !== null && maxOffset !== null
                        ? { min: minOffset, max: maxOffset }
                        : null,
            },
        };
    }
}
