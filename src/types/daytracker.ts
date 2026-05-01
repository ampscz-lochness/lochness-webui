// ── Calendar-based (non-REDCap) activity ─────────────────────────────────────

export type DayTrackerActivityRow = {
    day_offset: number;
    calendar_date: string;
    modality_key: string;
    unique_file_count: number;
    file_paths: string[];
};

// ── REDCap event-based activity ───────────────────────────────────────────────

/** Ordered protocol events extracted from pull_metadata->>'event_name'. */
export type RedcapEventRecord = {
    /** Raw REDCap event_name, e.g. "day_1a_predose_arm_1" */
    event_name: string;
    /** Derived numeric study day (null for screening / floating) */
    study_day: number | null;
    /** Human-readable event label, e.g. "Day 1a (Pre-dose)" */
    event_label: string;
    /** REDCap instrument/form name (null for whole-data pulls) */
    form_name: string | null;
    /** Specific field that was updated (only for file_attachment type) */
    field_name: string | null;
    /** Pull record type: "data" | "log" | "file_attachment" */
    record_type: string;
    /** Calendar date of the data pull (not the clinical event date) */
    pull_date: string;
    /** File path pulled */
    file_path: string | null;
};

export type DayTrackerSubject = {
    subject_id: string;
    site_id: string;
    consent_date: string | null;
    /** Calendar-offset activity for non-REDCap modalities */
    days: DayTrackerActivityRow[];
    /** REDCap event-based activity */
    redcap_events: RedcapEventRecord[];
};

export type DayTrackerPayload = {
    project_id: string;
    /** The field used as Day-1 anchor for non-REDCap modalities */
    day_variable: string;
    activity_by_subject: DayTrackerSubject[];
    /** Ordered list of all unique REDCap events found across all subjects */
    redcap_event_order: Array<{ event_name: string; event_label: string; study_day: number | null }>;
    /** Ordered list of all unique form names found across all subjects */
    redcap_forms: string[];
    metadata: {
        data_pulls_available: boolean;
        file_md5_available: boolean;
        day_offset_range: { min: number; max: number } | null;
    };
};
