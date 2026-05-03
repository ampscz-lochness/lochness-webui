// ── SharePoint file type ──────────────────────────────────────────────────────

/** Detected from file extension: .json files → "json", everything else → "actual" */
export type SharePointFileType = "json" | "actual";

// ── Calendar-based SharePoint file activity ───────────────────────────────────

export type SharePointActivityRow = {
    day_offset: number;
    calendar_date: string;
    modality_key: string;
    file_type: SharePointFileType;
    unique_file_count: number;
    file_paths: string[];
};

// ── Run sheet records from formsdb ────────────────────────────────────────────

export type RunSheetRecord = {
    /** formsdb form_name, e.g. "eeg_run_sheet" */
    form_name: string;
    form_instance_number: number | null;
    /** REDCap event name from form_data->>'redcap_event_name', if present */
    redcap_event_name: string | null;
    /** True when form_data is non-null and non-empty */
    has_data: boolean;
    /** Calendar date when run sheet was completed (from form_data timestamps or NULL if unavailable) */
    completion_date: string | null;
    /** Day offset from consent date */
    day_offset: number | null;
    /** Form data field summary: key=field name (e.g., 'completion', 'timestamp', 'acquired'), value=field value */
    form_data_summary?: Record<string, string>;
};

// ── Per-subject payload ───────────────────────────────────────────────────────

export type SharePointSubject = {
    subject_id: string;
    site_id: string;
    consent_date: string | null;
    is_consented: boolean;
    /** status_form.chrstatus_screenfail == 1 */
    is_screen_failed: boolean;
    /** status_form.chrstatus_withdrawal == 1 */
    is_withdrawn: boolean;
    screen_fail_reason: string | null;
    screen_fail_comments: string | null;
    /** Calendar date of Day 1a Pre-dose event from REDCap pull_metadata, if available */
    day1a_predose_date?: string | null;
    /** SharePoint file activity per calendar day, split by modality and file_type */
    days: SharePointActivityRow[];
    /** Run sheet form instances from formsdb */
    run_sheets: RunSheetRecord[];
};

// ── Top-level payload ─────────────────────────────────────────────────────────

export type SharePointPayload = {
    project_id: string;
    subjects: SharePointSubject[];
    /** Modality keys with any data in this project */
    modality_keys: string[];
    /** Run sheet form names discovered dynamically from formsdb */
    run_sheet_forms: string[];
    /** Maps run sheet form_name → SharePoint modality_key */
    run_sheet_form_to_modality: Record<string, string>;
    metadata: {
        data_pulls_available: boolean;
        file_md5_available: boolean;
        day_offset_range: { min: number; max: number } | null;
    };
};
