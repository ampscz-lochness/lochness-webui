import { getConnection } from "@/lib/db";
import { getFormsConnection } from "@/lib/formsdb";
import { getStatusFlagsBySubject } from "@/lib/models/forms-status";
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
    consent_date: string | null;
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

        const dataPullTable = await getFirstExistingTable(["data_pulls", "data_pull"]);

        const [subjectColumns, dataPullColumns] = await Promise.all([
            getColumns("subjects"),
            dataPullTable ? getColumns(dataPullTable) : Promise.resolve(new Set<string>()),
        ]);

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
             ORDER BY site_id, subject_id`,
            [projectId]
        );
        const consentSubjects = consentResult.rows as ConsentSubjectRow[];
        const subjectIds = consentSubjects.map((r) => r.subject_id);

        // ── 2. Status flags (formsdb) ─────────────────────────────────────────
        let statusFlagsBySubject = new Map<
            string,
            {
                is_screen_failed: boolean;
                is_withdrawn: boolean;
                screen_fail_reason: string | null;
                screen_fail_comments: string | null;
            }
        >();
        try {
            statusFlagsBySubject = await getStatusFlagsBySubject(projectId, subjectIds);
        } catch {
            // formsdb is intentionally isolated; keep tracker functional if unavailable
        }

        const emptyPayload: SharePointPayload = {
            project_id: projectId,
            subjects: consentSubjects.map((r) => ({
                subject_id: r.subject_id,
                site_id: r.site_id,
                consent_date: r.consent_date,
                is_consented: r.is_consented,
                is_screen_failed: statusFlagsBySubject.get(r.subject_id)?.is_screen_failed ?? false,
                is_withdrawn: statusFlagsBySubject.get(r.subject_id)?.is_withdrawn ?? false,
                screen_fail_reason: statusFlagsBySubject.get(r.subject_id)?.screen_fail_reason ?? null,
                screen_fail_comments: statusFlagsBySubject.get(r.subject_id)?.screen_fail_comments ?? null,
                days: [],
                run_sheets: [],
            })),
            modality_keys: [],
            run_sheet_forms: [],
            run_sheet_form_to_modality: {},
            metadata: {
                data_pulls_available: false,
                file_md5_available: hasFileMd5Column,
                day_offset_range: null,
            },
        };

        if (
            subjectIds.length === 0 ||
            !hasDataPullSubjectColumn ||
            !dataPullTableSql ||
            !pullTimestampColumn
        ) {
            return emptyPayload;
        }

        const pullSourceSelect = pullSourceColumn
            ? `${quoteIdentifier(pullSourceColumn)}::text`
            : "NULL::text";

        const filePathSelect = pullFilePathColumn
            ? `NULLIF(${quoteIdentifier(pullFilePathColumn)}::text, '')`
            : "NULL::text";

        // ── 3. SharePoint file pulls ──────────────────────────────────────────
        const subjectsWithConsentDate = consentSubjects
            .filter((r) => r.consent_date !== null)
            .map((r) => r.subject_id);

        const daysBySubject = new Map<string, SharePointActivityRow[]>();

        if (subjectsWithConsentDate.length > 0) {
            let activityQuery: string;

            if (hasFileMd5Column) {
                activityQuery = `
                    WITH consent_by_subject AS (
                        SELECT
                            subject_id,
                            ${CONSENT_DATE_CASE} AS consent_date
                        FROM public.subjects
                        WHERE project_id = $2
                          AND subject_id = ANY($1::text[])
                    ),
                    classified AS (
                        SELECT
                            p.subject_id,
                            ${SP_MODALITY_CASE(pullSourceSelect)} AS modality_key,
                            CASE WHEN LOWER(COALESCE(${filePathSelect}, '')) LIKE '%.json'
                                THEN 'json' ELSE 'actual'
                            END AS file_type,
                            date_trunc('day', p.${quoteIdentifier(pullTimestampColumn)}::timestamptz)::date AS calendar_date,
                            p.${quoteIdentifier(pullTimestampColumn)}::timestamptz AS pull_ts,
                            NULLIF(p.file_md5::text, '') AS file_md5,
                            ${filePathSelect} AS file_path
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
                    SELECT
                        d.subject_id,
                        d.modality_key,
                        d.file_type,
                        d.calendar_date::text AS calendar_date,
                        (d.calendar_date - c.consent_date)::int AS day_offset,
                        COUNT(*)::int AS unique_file_count,
                        COALESCE(
                            array_agg(d.file_path ORDER BY d.pull_ts DESC NULLS LAST)
                                FILTER (WHERE d.file_path IS NOT NULL),
                            ARRAY[]::text[]
                        ) AS file_paths
                    FROM deduped d
                    JOIN consent_by_subject c USING (subject_id)
                    WHERE c.consent_date IS NOT NULL
                    GROUP BY d.subject_id, d.modality_key, d.file_type, d.calendar_date, c.consent_date
                    ORDER BY d.subject_id, day_offset, d.modality_key, d.file_type
                    LIMIT 10000
                `;
            } else {
                activityQuery = `
                    WITH consent_by_subject AS (
                        SELECT
                            subject_id,
                            ${CONSENT_DATE_CASE} AS consent_date
                        FROM public.subjects
                        WHERE project_id = $2
                          AND subject_id = ANY($1::text[])
                    ),
                    classified AS (
                        SELECT
                            p.subject_id,
                            ${SP_MODALITY_CASE(pullSourceSelect)} AS modality_key,
                            CASE WHEN LOWER(COALESCE(${filePathSelect}, '')) LIKE '%.json'
                                THEN 'json' ELSE 'actual'
                            END AS file_type,
                            date_trunc('day', p.${quoteIdentifier(pullTimestampColumn)}::timestamptz)::date AS calendar_date,
                            p.${quoteIdentifier(pullTimestampColumn)}::timestamptz AS pull_ts,
                            ${filePathSelect} AS file_path
                        FROM ${dataPullTableSql} p
                        WHERE p.subject_id = ANY($1::text[])
                          ${hasDataPullProjectColumn ? "AND p.project_id = $2" : ""}
                          AND p.${quoteIdentifier(pullTimestampColumn)} IS NOT NULL
                    )
                    SELECT
                        c2.subject_id,
                        c2.modality_key,
                        c2.file_type,
                        c2.calendar_date::text AS calendar_date,
                        (c2.calendar_date - cs.consent_date)::int AS day_offset,
                        COUNT(*)::int AS unique_file_count,
                        COALESCE(
                            array_agg(c2.file_path ORDER BY c2.pull_ts DESC NULLS LAST)
                                FILTER (WHERE c2.file_path IS NOT NULL),
                            ARRAY[]::text[]
                        ) AS file_paths
                    FROM classified c2
                    JOIN consent_by_subject cs USING (subject_id)
                    WHERE c2.modality_key IS NOT NULL
                      AND cs.consent_date IS NOT NULL
                    GROUP BY c2.subject_id, c2.modality_key, c2.file_type, c2.calendar_date, cs.consent_date
                    ORDER BY c2.subject_id, day_offset, c2.modality_key, c2.file_type
                    LIMIT 10000
                `;
            }

            const activityResult = await connection.query(activityQuery, [
                subjectsWithConsentDate,
                projectId,
            ]);

            for (const row of activityResult.rows as SpActivityRow[]) {
                if (!daysBySubject.has(row.subject_id)) {
                    daysBySubject.set(row.subject_id, []);
                }
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

        // ── 4. Discover run sheet forms + records (formsdb) ───────────────────
        let runSheetForms: string[] = [];
        const runSheetsBySubject = new Map<string, RunSheetRecord[]>();

        try {
            const formsConn = getFormsConnection();

            // Discover forms with SharePoint-relevant names for this project's subjects
            const discoverResult = await formsConn.query(
                `SELECT DISTINCT rf.form_name
                 FROM forms.redcap_forms rf
                 JOIN public.subjects s ON s.subject_id = rf.subject_id
                 JOIN public.sites si ON si.site_id = s.site_id
                 WHERE si.project_id = $1
                   AND (
                       LOWER(rf.form_name) LIKE '%eeg%'
                    OR LOWER(rf.form_name) LIKE '%transcript%'
                    OR LOWER(rf.form_name) LIKE '%mindlamp%'
                    OR LOWER(rf.form_name) LIKE '%run_sheet%'
                    OR LOWER(rf.form_name) LIKE '%runsheet%'
                    OR LOWER(rf.form_name) LIKE '%sharepoint%'
                   )
                 ORDER BY rf.form_name`,
                [projectId]
            );
            runSheetForms = (discoverResult.rows as { form_name: string }[]).map((r) => r.form_name);

            if (runSheetForms.length > 0) {
                const recordsResult = await formsConn.query(
                    `SELECT
                         rf.subject_id,
                         rf.form_name,
                         rf.form_instance_number,
                         rf.form_data->>'redcap_event_name' AS redcap_event_name,
                         rf.form_data,
                         NULLIF(subject_metadata->>'consent_date', '')::text AS consent_date,
                         (
                             rf.form_data IS NOT NULL
                             AND rf.form_data::text <> '{}'
                             AND rf.form_data::text <> 'null'
                             AND (
                                 -- REDCap completion status = Complete (2)
                                 rf.form_data->>(rf.form_name || '_complete') = '2'
                                 -- Primary signal: any *_performed field = '1' (used by all known run sheet forms)
                                 OR EXISTS (
                                     SELECT 1 FROM jsonb_each_text(rf.form_data) AS kv
                                     WHERE kv.key LIKE '%_performed' AND kv.value = '1'
                                 )
                                 -- Explicit data acquisition flags (legacy field names)
                                 OR COALESCE(LOWER(rf.form_data->>'data_acquired'), '') IN ('yes', 'true', '1', 'y')
                                 OR COALESCE(LOWER(rf.form_data->>'session_completed'), '') IN ('yes', 'true', '1', 'y')
                                 OR COALESCE(LOWER(rf.form_data->>'session_data_acquired'), '') IN ('yes', 'true', '1', 'y')
                                 OR COALESCE(LOWER(rf.form_data->>'acquisition_complete'), '') IN ('yes', 'true', '1', 'y')
                                 -- EEG-specific: eeg_data_collected, eeg_acquired
                                 OR COALESCE(LOWER(rf.form_data->>'eeg_data_collected'), '') IN ('yes', 'true', '1', 'y')
                                 OR COALESCE(LOWER(rf.form_data->>'eeg_acquired'), '') IN ('yes', 'true', '1', 'y')
                                 -- MindLAMP-specific: checkin_complete, data_collected
                                 OR COALESCE(LOWER(rf.form_data->>'checkin_complete'), '') IN ('yes', 'true', '1', 'y')
                                 OR COALESCE(LOWER(rf.form_data->>'data_collected'), '') IN ('yes', 'true', '1', 'y')
                                 -- Transcript-specific: recording_complete, transcript_acquired
                                 OR COALESCE(LOWER(rf.form_data->>'recording_complete'), '') IN ('yes', 'true', '1', 'y')
                                 OR COALESCE(LOWER(rf.form_data->>'transcript_acquired'), '') IN ('yes', 'true', '1', 'y')
                                 -- Generic: any field ending in _complete = '2' (catches other REDCap instruments)
                                 OR EXISTS (
                                     SELECT 1 FROM jsonb_each_text(rf.form_data) AS kv
                                     WHERE kv.key LIKE '%_complete' AND kv.value = '2'
                                 )
                             )
                         ) AS has_data
                     FROM forms.redcap_forms rf
                     JOIN public.subjects s ON s.subject_id = rf.subject_id
                     JOIN public.sites si ON si.site_id = s.site_id
                     WHERE si.project_id = $1
                       AND rf.form_name = ANY($2::text[])
                     ORDER BY rf.subject_id, rf.form_name, COALESCE(rf.form_instance_number, 0)`,
                    [projectId, runSheetForms]
                );

                // Helper to extract session date from form_data.
                // Priority: *_interview_date (used by all known run sheet forms), then *_timestamp.
                const extractFormTimestamp = (form: Record<string, unknown> | null, formName: string): string | null => {
                    if (!form) return null;
                    // Priority 1: any field ending in _interview_date (chreeg_interview_date, chrdig_interview_date, chrav_interview_date, …)
                    for (const [key, val] of Object.entries(form)) {
                        if (key.endsWith('_interview_date') && val && typeof val === 'string') {
                            const trimmed = val.trim();
                            if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
                        }
                    }
                    // Priority 2: [form_name]_timestamp
                    const timestampKey = `${formName}_timestamp`;
                    const ts = form[timestampKey] as string | undefined;
                    if (ts && typeof ts === 'string' && ts.trim()) {
                        return ts.trim().split('T')[0];
                    }
                    // Priority 3: generic timestamp
                    const genericTs = form['timestamp'] as string | undefined;
                    if (genericTs && typeof genericTs === 'string' && genericTs.trim()) {
                        return genericTs.trim().split('T')[0];
                    }
                    return null;
                };

                // Helper to extract relevant form_data fields for run sheet display.
                // Uses pattern matching on field names to work across all form types.
                const extractRunSheetFieldSummary = (form: Record<string, unknown> | null, formName: string): Record<string, string> => {
                    const summary: Record<string, string> = {};
                    if (!form) return summary;

                    // REDCap completion status: [form_name]_complete
                    const completionKey = `${formName}_complete`;
                    const completionVal = form[completionKey];
                    if (completionVal !== null && completionVal !== undefined) {
                        summary['completion'] = String(completionVal).trim();
                    }

                    // Session date: any field ending in _interview_date
                    for (const [key, val] of Object.entries(form)) {
                        if (key.endsWith('_interview_date') && val && typeof val === 'string') {
                            const trimmed = val.trim();
                            if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
                                summary['session_date'] = trimmed;
                                break;
                            }
                        }
                    }

                    // Performed / acquired: any field ending in _performed (1=yes, 0=no)
                    for (const [key, val] of Object.entries(form)) {
                        if (key.endsWith('_performed') && val !== null && val !== undefined) {
                            summary['performed'] = String(val).trim();
                            break;
                        }
                    }

                    // REDCap user: any field ending in _redcap_user
                    for (const [key, val] of Object.entries(form)) {
                        if (key.endsWith('_redcap_user') && val && typeof val === 'string') {
                            const trimmed = val.trim();
                            if (trimmed) { summary['redcap_user'] = trimmed; break; }
                        }
                    }

                    // Technician/RA: any field ending in _primaryperson
                    for (const [key, val] of Object.entries(form)) {
                        if (key.endsWith('_primaryperson') && val && typeof val === 'string') {
                            const trimmed = val.trim();
                            if (trimmed) { summary['technician'] = trimmed; break; }
                        }
                    }

                    // Start time: any field ending in _start
                    for (const [key, val] of Object.entries(form)) {
                        if (key.endsWith('_start') && val && typeof val === 'string') {
                            const trimmed = val.trim();
                            if (trimmed) { summary['start_time'] = trimmed; break; }
                        }
                    }

                    // End time: any field ending in _end
                    for (const [key, val] of Object.entries(form)) {
                        if (key.endsWith('_end') && val && typeof val === 'string') {
                            const trimmed = val.trim();
                            if (trimmed) { summary['end_time'] = trimmed; break; }
                        }
                    }

                    // EEG runs completed: count keys matching chreeg_run[0-9]+ = '1'
                    let runsCompleted = 0;
                    let runsTotal = 0;
                    for (const [key, val] of Object.entries(form)) {
                        if (/^chreeg_run\d+$/.test(key)) {
                            runsTotal++;
                            if (String(val).trim() === '1') runsCompleted++;
                        }
                    }
                    if (runsTotal > 0) summary['runs'] = `${runsCompleted}/${runsTotal}`;

                    // Cap size and head circumference (EEG-specific)
                    if (form['chreeg_cap_size'] !== null && form['chreeg_cap_size'] !== undefined) {
                        summary['cap_size'] = String(form['chreeg_cap_size']).trim();
                    }
                    if (form['chreeg_head_cir'] !== null && form['chreeg_head_cir'] !== undefined) {
                        summary['head_cir'] = String(form['chreeg_head_cir']).trim();
                    }

                    // Data upload flags (transcript form: chrav_nsi_upload, chrav_psychs_upload)
                    if (form['chrav_nsi_upload'] !== null && form['chrav_nsi_upload'] !== undefined) {
                        summary['nsi_upload'] = String(form['chrav_nsi_upload']).trim();
                    }
                    if (form['chrav_psychs_upload'] !== null && form['chrav_psychs_upload'] !== undefined) {
                        summary['psychs_upload'] = String(form['chrav_psychs_upload']).trim();
                    }

                    return summary;
                };

                // ── Cross-reference event names from data_pulls ────────────
                // Some run sheets may not have redcap_event_name in form_data; try data_pulls
                const eventNameFromPulls = new Map<string, string>(); // key: subject_id|form_name|instance
                try {
                    if (dataPullTable && hasPullMetadataColumn) {
                        const crossRefQuery = `
                            SELECT DISTINCT ON (dp.subject_id, dp.pull_metadata->>'form_name', COALESCE((dp.pull_metadata->>'form_instance_number')::int, 0))
                                dp.subject_id,
                                dp.pull_metadata->>'form_name' AS form_name,
                                COALESCE((dp.pull_metadata->>'form_instance_number')::int, 0) AS form_instance_number,
                                dp.pull_metadata->>'event_name' AS event_name
                            FROM ${quoteIdentifier(dataPullTable)} dp
                            JOIN public.subjects s ON s.subject_id = dp.subject_id
                            JOIN public.sites si ON si.site_id = s.site_id
                            WHERE si.project_id = $1
                              AND dp.pull_metadata->>'form_name' = ANY($2::text[])
                              AND dp.pull_metadata->>'event_name' IS NOT NULL
                            ORDER BY dp.subject_id, dp.pull_metadata->>'form_name', COALESCE((dp.pull_metadata->>'form_instance_number')::int, 0), dp.pull_timestamp DESC
                        `;
                        const crossRefResult = await connection.query(crossRefQuery, [projectId, runSheetForms]);
                        for (const row of crossRefResult.rows as { subject_id: string; form_name: string; form_instance_number: number; event_name: string }[]) {
                            const key = `${row.subject_id}|${row.form_name}|${row.form_instance_number}`;
                            if (!eventNameFromPulls.has(key)) {
                                eventNameFromPulls.set(key, row.event_name);
                            }
                        }
                    }
                } catch {
                    // Non-critical; continue without cross-reference
                }

                for (const row of recordsResult.rows as RunSheetRow[]) {
                    if (!runSheetsBySubject.has(row.subject_id)) {
                        runSheetsBySubject.set(row.subject_id, []);
                    }

                    // Cross-reference event name from data_pulls if form_data doesn't have it
                    let redcapEventName = row.redcap_event_name;
                    if (!redcapEventName) {
                        const crossRefKey = `${row.subject_id}|${row.form_name}|${row.form_instance_number ?? 0}`;
                        redcapEventName = eventNameFromPulls.get(crossRefKey) ?? null;
                    }

                    // Calculate day offset from consent date
                    let dayOffset: number | null = null;
                    let completionDate: string | null = null;

                    const formTimestamp = extractFormTimestamp(row.form_data, row.form_name);
                    if (formTimestamp && row.consent_date) {
                        completionDate = formTimestamp;
                        try {
                            const consentDateParsed = new Date(row.consent_date);
                            const formDateParsed = new Date(formTimestamp);
                            dayOffset = Math.floor((formDateParsed.getTime() - consentDateParsed.getTime()) / (1000 * 60 * 60 * 24));
                        } catch {
                            // If date parsing fails, keep dayOffset as null
                        }
                    }

                    runSheetsBySubject.get(row.subject_id)!.push({
                        form_name: row.form_name,
                        form_instance_number: row.form_instance_number,
                        redcap_event_name: redcapEventName,
                        has_data: Boolean(row.has_data),
                        completion_date: completionDate,
                        day_offset: dayOffset,
                        form_data_summary: extractRunSheetFieldSummary(row.form_data, row.form_name),
                    });
                }
            }
        } catch {
            // formsdb unavailable — continue without run sheet data
        }

        // ── 5. Build run_sheet_form_to_modality map ───────────────────────────
        const runSheetFormToModality: Record<string, string> = {};
        for (const form of runSheetForms) {
            const modality = formNameToModality(form);
            if (modality) runSheetFormToModality[form] = modality;
        }

        // ── 5b. Query Day 1a Pre-dose dates from data_pulls ──────────────────
        const day1aDatesBySubject = new Map<string, string>();
        try {
            if (dataPullTable && hasPullMetadataColumn) {
                const day1aQuery = `
                    SELECT
                        s.subject_id,
                        MIN((dp.pull_timestamp::date)::text) AS day1a_date
                    FROM ${quoteIdentifier(dataPullTable)} dp
                    JOIN public.subjects s ON s.subject_id = dp.subject_id
                    JOIN public.sites si ON si.site_id = s.site_id
                    WHERE si.project_id = $1
                      AND dp.pull_metadata->>'event_name' ILIKE '%day_1a%predose%'
                    GROUP BY s.subject_id
                `;
                const day1aResult = await connection.query(day1aQuery, [projectId]);
                for (const row of day1aResult.rows as { subject_id: string; day1a_date: string }[]) {
                    day1aDatesBySubject.set(row.subject_id, row.day1a_date);
                }
            }
        } catch {
            // If Day 1a query fails, continue without Day 1a dates
        }

        // ── 5c. Query SharePoint form submission dates (response.submitted.json) ──
        // sharepoint.sharepoint_forms stores one row per subject+REDCap event.
        // form_data->>'event_date' is the actual EEG (or other modality) scan date
        // recorded in the submitted SharePoint form. We compare this against the
        // run sheet session_date (*_interview_date) to detect date mismatches.
        try {
            const formsConn = getFormsConnection();
            const spFormResult = await formsConn.query(
                `SELECT subject_id,
                        (form_data->>'event_date')::date::text AS event_date
                 FROM sharepoint.sharepoint_forms
                 WHERE subject_id = ANY($1::text[])
                   AND form_data->>'event_date' IS NOT NULL`,
                [subjectIds]
            );
            // Build lookup: subject_id → sorted list of SP form event_dates
            const spDatesBySubject = new Map<string, string[]>();
            for (const row of spFormResult.rows as { subject_id: string; event_date: string }[]) {
                if (!spDatesBySubject.has(row.subject_id)) spDatesBySubject.set(row.subject_id, []);
                spDatesBySubject.get(row.subject_id)!.push(row.event_date);
            }
            // For each run sheet, find the nearest SP form date for that subject and attach it.
            // This lets the frontend show the SP form date and flag mismatches.
            for (const [subjectId, runSheets] of runSheetsBySubject) {
                const spDates = spDatesBySubject.get(subjectId) ?? [];
                if (spDates.length === 0) continue;
                for (const rs of runSheets) {
                    const sessionDate = rs.form_data_summary?.["session_date"] ?? null;
                    if (!sessionDate) continue;
                    // Find the nearest SP form date
                    let nearest: string | null = null;
                    let nearestDiff = Infinity;
                    for (const spDate of spDates) {
                        try {
                            const diff = Math.abs(new Date(spDate).getTime() - new Date(sessionDate).getTime()) / (1000 * 60 * 60 * 24);
                            if (diff < nearestDiff) { nearestDiff = diff; nearest = spDate; }
                        } catch { /* ignore parse errors */ }
                    }
                    if (nearest !== null) {
                        rs.form_data_summary = { ...(rs.form_data_summary ?? {}), sp_event_date: nearest };
                    }
                }
            }
        } catch {
            // sharepoint.sharepoint_forms unavailable — continue without SP form dates
        }

        // ── 6. Assemble per-subject payload ───────────────────────────────────
        const subjects: SharePointSubject[] = consentSubjects.map((row) => ({
            subject_id: row.subject_id,
            site_id: row.site_id,
            consent_date: row.consent_date,
            is_consented: row.is_consented,
            is_screen_failed: statusFlagsBySubject.get(row.subject_id)?.is_screen_failed ?? false,
            is_withdrawn: statusFlagsBySubject.get(row.subject_id)?.is_withdrawn ?? false,
            screen_fail_reason: statusFlagsBySubject.get(row.subject_id)?.screen_fail_reason ?? null,
            screen_fail_comments: statusFlagsBySubject.get(row.subject_id)?.screen_fail_comments ?? null,
            day1a_predose_date: day1aDatesBySubject.get(row.subject_id) ?? null,
            days: daysBySubject.get(row.subject_id) ?? [],
            run_sheets: runSheetsBySubject.get(row.subject_id) ?? [],
        }));

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
                day_offset_range:
                    minOffset !== null && maxOffset !== null
                        ? { min: minOffset, max: maxOffset }
                        : null,
            },
        };
    }
}
