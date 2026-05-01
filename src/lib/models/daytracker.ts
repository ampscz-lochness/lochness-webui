import { getConnection } from "@/lib/db";
import type { DayTrackerPayload, DayTrackerSubject, RedcapEventRecord } from "@/types/daytracker";

type TableName = "subjects" | "data_pulls" | "data_pull";

type ConsentSubjectRow = {
    subject_id: string;
    site_id: string;
    consent_date: string | null;
};

type DayActivityRow = {
    subject_id: string;
    modality_key: string;
    calendar_date: string;
    day_offset: string;
    unique_file_count: string;
    file_paths: string[] | null;
};

type RedcapEventRow = {
    subject_id: string;
    event_name: string;
    form_name: string | null;
    field_name: string | null;
    record_type: string;
    pull_date: string;
    file_path: string | null;
};

// ── REDCap event ordering ─────────────────────────────────────────────────────

/**
 * Map from event_name → canonical study day number (null = no numeric day).
 * Ordering is used to sort events chronologically on the X axis.
 */
const REDCAP_EVENT_ORDER: Array<{ event_name_pattern: RegExp; label: string; study_day: number | null; order: number }> = [
    { event_name_pattern: /screening/i,        label: "Screening",            study_day: null,  order: -1  },
    { event_name_pattern: /day_1a_predose/i,   label: "Day 1a (Pre-dose)",    study_day: 1,     order: 1   },
    { event_name_pattern: /day_1b_postdose/i,  label: "Day 1b (Post-dose)",   study_day: 1,     order: 2   },
    { event_name_pattern: /^day_1_arm/i,       label: "Day 1",                study_day: 1,     order: 3   },
    { event_name_pattern: /^day_7_arm/i,       label: "Day 7",                study_day: 7,     order: 7   },
    { event_name_pattern: /^day_8_arm/i,       label: "Day 8",                study_day: 8,     order: 8   },
    { event_name_pattern: /^day_15_arm/i,      label: "Day 15",               study_day: 15,    order: 15  },
    { event_name_pattern: /^day_29_arm/i,      label: "Day 29",               study_day: 29,    order: 29  },
    { event_name_pattern: /^day_43_arm/i,      label: "Day 43",               study_day: 43,    order: 43  },
    { event_name_pattern: /^day_56_arm/i,      label: "Day 56",               study_day: 56,    order: 56  },
    { event_name_pattern: /floating/i,         label: "Floating Forms",       study_day: null,  order: 999 },
];

function parseEventMeta(eventName: string): { label: string; study_day: number | null; order: number } {
    for (const entry of REDCAP_EVENT_ORDER) {
        if (entry.event_name_pattern.test(eventName)) {
            return { label: entry.label, study_day: entry.study_day, order: entry.order };
        }
    }
    // Fallback: try to extract day number from event_name itself
    const match = eventName.match(/day_(\d+)/i);
    if (match) {
        const day = parseInt(match[1], 10);
        return { label: `Day ${day}`, study_day: day, order: day };
    }
    return { label: eventName, study_day: null, order: 9998 };
}

export class DayTrackerModelError extends Error {
    constructor(
        message: string,
        public readonly status: number,
        public readonly details?: Record<string, unknown>
    ) {
        super(message);
        this.name = "DayTrackerModelError";
    }
}

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

const MODALITY_CASE = (pullSourceSelect: string) => `
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
    END
`;

export class DayTracker {
    static async getProjectDayTracker(projectId: string): Promise<DayTrackerPayload> {
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
            throw new DayTrackerModelError("subjects table is missing required columns", 500, {
                required: ["project_id", "subject_id", "site_id", "subject_metadata"],
            });
        }

        const hasDataPullSubjectColumn = Boolean(dataPullTable) && dataPullColumns.has("subject_id");
        const hasDataPullProjectColumn = dataPullColumns.has("project_id");
        const dataPullTableSql = dataPullTable ? `public.${quoteIdentifier(dataPullTable)}` : null;
        const hasPullMetadataColumn = dataPullColumns.has("pull_metadata");

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

        // 1. Get all subjects for this project (those with consent_date preferred; fallback to all consented)
        const consentSubjectsQuery = `
            SELECT
                subject_id,
                site_id,
                NULLIF(subject_metadata->>'consent_date', '')::text AS consent_date
            FROM public.subjects
            WHERE project_id = $1
              AND COALESCE(subject_metadata->>'missing_required_variables', 'NOT_EMPTY') = ''
            ORDER BY site_id, subject_id
        `;

        const consentResult = await connection.query(consentSubjectsQuery, [projectId]);
        const consentSubjects = consentResult.rows as ConsentSubjectRow[];
        const subjectIds = consentSubjects.map((r) => r.subject_id);

        const consentDateBySubject = new Map(
            consentSubjects.map((r) => [r.subject_id, r.consent_date])
        );
        const siteBySubject = new Map(
            consentSubjects.map((r) => [r.subject_id, r.site_id])
        );

        const emptyPayload: DayTrackerPayload = {
            project_id: projectId,
            day_variable: "redcap_event_name",
            activity_by_subject: consentSubjects.map((r) => ({
                subject_id: r.subject_id,
                site_id: r.site_id,
                consent_date: r.consent_date,
                days: [],
                redcap_events: [],
            })),
            redcap_event_order: [],
            redcap_forms: [],
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

        // ── 2. REDCap event-based activity ────────────────────────────────────
        // Extract event_name, form_name, field_name from pull_metadata for REDCap pulls.
        // This gives us the protocol-visit dimension directly.
        const redcapEventsBySubject = new Map<string, RedcapEventRecord[]>();

        if (hasPullMetadataColumn) {
            const redcapQuery = `
                SELECT
                    subject_id,
                    pull_metadata->>'event_name'   AS event_name,
                    pull_metadata->>'form_name'    AS form_name,
                    pull_metadata->>'field_name'   AS field_name,
                    pull_metadata->>'type'         AS record_type,
                    ${quoteIdentifier(pullTimestampColumn)}::date::text AS pull_date,
                    ${filePathSelect}              AS file_path
                FROM ${dataPullTableSql}
                WHERE subject_id = ANY($1::text[])
                  ${hasDataPullProjectColumn ? "AND project_id = $2" : ""}
                  AND LOWER(COALESCE(${pullSourceSelect}, '')) LIKE '%redcap%'
                  AND pull_metadata->>'event_name' IS NOT NULL
                  AND ${quoteIdentifier(pullTimestampColumn)} IS NOT NULL
                ORDER BY subject_id, ${quoteIdentifier(pullTimestampColumn)} DESC
                LIMIT 10000
            `;
            const redcapParams = hasDataPullProjectColumn ? [subjectIds, projectId] : [subjectIds];
            const redcapResult = await connection.query(redcapQuery, redcapParams);

            for (const row of redcapResult.rows as RedcapEventRow[]) {
                if (!redcapEventsBySubject.has(row.subject_id)) {
                    redcapEventsBySubject.set(row.subject_id, []);
                }
                const { label, study_day } = parseEventMeta(row.event_name);
                redcapEventsBySubject.get(row.subject_id)!.push({
                    event_name: row.event_name,
                    study_day,
                    event_label: label,
                    form_name: row.form_name ?? null,
                    field_name: row.field_name ?? null,
                    record_type: row.record_type ?? "data",
                    pull_date: row.pull_date,
                    file_path: row.file_path ?? null,
                });
            }
        }

        // ── 3. Calendar-based activity for non-REDCap modalities ─────────────
        // Only for subjects with a consent_date (used as Day-1 anchor for
        // MindLAMP, CANTAB, EEG etc.).
        const subjectsWithConsentDate = consentSubjects
            .filter((r) => r.consent_date !== null)
            .map((r) => r.subject_id);

        const daysBySubject = new Map<string, DayTrackerSubject["days"]>();

        if (subjectsWithConsentDate.length > 0) {
            let activityQuery: string;

            if (hasFileMd5Column) {
                activityQuery = `
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
                    first_seen_per_md5 AS (
                        SELECT DISTINCT ON (
                            p.subject_id,
                            ${MODALITY_CASE(pullSourceSelect)},
                            NULLIF(p.file_md5::text, '')
                        )
                            p.subject_id,
                            ${MODALITY_CASE(pullSourceSelect)} AS modality_key,
                            date_trunc('day', p.${quoteIdentifier(pullTimestampColumn)}::timestamptz)::date AS calendar_date,
                            p.${quoteIdentifier(pullTimestampColumn)}::timestamptz AS first_seen_ts,
                            NULLIF(p.file_md5::text, '') AS file_md5,
                            ${filePathSelect} AS file_path
                        FROM ${dataPullTableSql} p
                        WHERE p.subject_id = ANY($1::text[])
                          ${hasDataPullProjectColumn ? "AND p.project_id = $2" : ""}
                          AND NULLIF(p.file_md5::text, '') IS NOT NULL
                          AND p.${quoteIdentifier(pullTimestampColumn)} IS NOT NULL
                        ORDER BY
                            p.subject_id,
                            ${MODALITY_CASE(pullSourceSelect)},
                            NULLIF(p.file_md5::text, ''),
                            p.${quoteIdentifier(pullTimestampColumn)}::timestamptz ASC NULLS LAST
                    )
                    SELECT
                        f.subject_id,
                        f.modality_key,
                        f.calendar_date::text AS calendar_date,
                        (f.calendar_date - c.consent_date)::int AS day_offset,
                        COUNT(*)::int AS unique_file_count,
                        COALESCE(
                            array_agg(f.file_path ORDER BY f.first_seen_ts DESC NULLS LAST)
                                FILTER (WHERE f.file_path IS NOT NULL),
                            ARRAY[]::text[]
                        ) AS file_paths
                    FROM first_seen_per_md5 f
                    JOIN consent_by_subject c USING (subject_id)
                    WHERE f.modality_key IS NOT NULL
                                            AND f.modality_key <> 'redcap'
                      AND c.consent_date IS NOT NULL
                    GROUP BY f.subject_id, f.modality_key, f.calendar_date, c.consent_date
                    ORDER BY f.subject_id, day_offset, f.modality_key
                    LIMIT 10000
                `;
            } else {
                activityQuery = `
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
                    raw_pulls AS (
                        SELECT
                            p.subject_id,
                            ${MODALITY_CASE(pullSourceSelect)} AS modality_key,
                            date_trunc('day', p.${quoteIdentifier(pullTimestampColumn)}::timestamptz)::date AS calendar_date,
                            p.${quoteIdentifier(pullTimestampColumn)}::timestamptz AS pull_ts,
                            ${filePathSelect} AS file_path
                        FROM ${dataPullTableSql} p
                        WHERE p.subject_id = ANY($1::text[])
                          ${hasDataPullProjectColumn ? "AND p.project_id = $2" : ""}
                          AND p.${quoteIdentifier(pullTimestampColumn)} IS NOT NULL
                    )
                    SELECT
                        r.subject_id,
                        r.modality_key,
                        r.calendar_date::text AS calendar_date,
                        (r.calendar_date - c.consent_date)::int AS day_offset,
                        COUNT(*)::int AS unique_file_count,
                        COALESCE(
                            array_agg(r.file_path ORDER BY r.pull_ts DESC NULLS LAST)
                                FILTER (WHERE r.file_path IS NOT NULL),
                            ARRAY[]::text[]
                        ) AS file_paths
                    FROM raw_pulls r
                    JOIN consent_by_subject c USING (subject_id)
                    WHERE r.modality_key IS NOT NULL
                                            AND r.modality_key <> 'redcap'
                      AND c.consent_date IS NOT NULL
                    GROUP BY r.subject_id, r.modality_key, r.calendar_date, c.consent_date
                    ORDER BY r.subject_id, day_offset, r.modality_key
                    LIMIT 10000
                `;
            }

            const activityResult = await connection.query(activityQuery, [subjectsWithConsentDate, projectId]);

            for (const row of activityResult.rows as DayActivityRow[]) {
                if (!daysBySubject.has(row.subject_id)) {
                    daysBySubject.set(row.subject_id, []);
                }
                daysBySubject.get(row.subject_id)!.push({
                    day_offset: parseCount(row.day_offset),
                    calendar_date: row.calendar_date,
                    modality_key: row.modality_key,
                    unique_file_count: parseCount(row.unique_file_count),
                    file_paths: row.file_paths ?? [],
                });
            }
        }

        // ── 4. Assemble per-subject payload ───────────────────────────────────
        const activityBySubject: DayTrackerSubject[] = consentSubjects.map((row) => ({
            subject_id: row.subject_id,
            site_id: siteBySubject.get(row.subject_id) ?? row.site_id,
            consent_date: consentDateBySubject.get(row.subject_id) ?? null,
            days: daysBySubject.get(row.subject_id) ?? [],
            redcap_events: redcapEventsBySubject.get(row.subject_id) ?? [],
        }));

        // ── 5. Build global ordered event list (across all subjects) ──────────
        const seenEvents = new Map<string, { event_label: string; study_day: number | null; order: number }>();
        for (const subject of activityBySubject) {
            for (const ev of subject.redcap_events) {
                if (!seenEvents.has(ev.event_name)) {
                    const { label, study_day, order } = { ...parseEventMeta(ev.event_name), label: ev.event_label };
                    seenEvents.set(ev.event_name, { event_label: label, study_day, order });
                }
            }
        }
        const redcapEventOrder = [...seenEvents.entries()]
            .sort((a, b) => (a[1].order ?? 9999) - (b[1].order ?? 9999))
            .map(([event_name, meta]) => ({
                event_name,
                event_label: meta.event_label,
                study_day: meta.study_day,
            }));

        // ── 6. Build global ordered form list ────────────────────────────────
        const seenForms = new Set<string>();
        for (const subject of activityBySubject) {
            for (const ev of subject.redcap_events) {
                if (ev.form_name) seenForms.add(ev.form_name);
            }
        }
        const redcapForms = [...seenForms].sort();

        // ── 7. Compute calendar day_offset range (non-REDCap) ────────────────
        let minOffset: number | null = null;
        let maxOffset: number | null = null;
        for (const subject of activityBySubject) {
            for (const day of subject.days) {
                if (minOffset === null || day.day_offset < minOffset) minOffset = day.day_offset;
                if (maxOffset === null || day.day_offset > maxOffset) maxOffset = day.day_offset;
            }
        }

        return {
            project_id: projectId,
            day_variable: "redcap_event_name",
            activity_by_subject: activityBySubject,
            redcap_event_order: redcapEventOrder,
            redcap_forms: redcapForms,
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
