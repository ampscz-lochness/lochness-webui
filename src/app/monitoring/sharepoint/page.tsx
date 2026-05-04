"use client";
import * as React from "react";
import { CloudUpload, RefreshCcw } from "lucide-react";
import { toast } from "sonner";

import { Heading } from "@/components/heading";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import type { SharePointPayload } from "@/types/sharepoint-tracker";

// ── Modality config ───────────────────────────────────────────────────────────

const SHAREPOINT_MODALITIES = [
    { key: "eeg_sharepoint", label: "EEG" },
    { key: "mindlamp_qc_sharepoint", label: "MindLAMP QC" },
    { key: "transcript_sharepoint", label: "Transcript" },
] as const;

type SpModalityKey = (typeof SHAREPOINT_MODALITIES)[number]["key"];

/** Two shades per modality: lighter for JSON, darker for actual file */
const SP_COLORS: Record<SpModalityKey, { json: string; actual: string }> = {
    eeg_sharepoint: { json: "#0ea5e9", actual: "#0369a1" },
    mindlamp_qc_sharepoint: { json: "#ec4899", actual: "#be185d" },
    transcript_sharepoint: { json: "#14b8a6", actual: "#0f766e" },
};

const SP_SERIES = [
    { key: "eeg_sharepoint" as SpModalityKey, fileType: "json" as const, label: "EEG JSON", color: SP_COLORS.eeg_sharepoint.json },
    { key: "eeg_sharepoint" as SpModalityKey, fileType: "actual" as const, label: "EEG File", color: SP_COLORS.eeg_sharepoint.actual },
    { key: "mindlamp_qc_sharepoint" as SpModalityKey, fileType: "json" as const, label: "MindLAMP QC JSON", color: SP_COLORS.mindlamp_qc_sharepoint.json },
    { key: "mindlamp_qc_sharepoint" as SpModalityKey, fileType: "actual" as const, label: "MindLAMP QC File", color: SP_COLORS.mindlamp_qc_sharepoint.actual },
    { key: "transcript_sharepoint" as SpModalityKey, fileType: "json" as const, label: "Transcript JSON", color: SP_COLORS.transcript_sharepoint.json },
    { key: "transcript_sharepoint" as SpModalityKey, fileType: "actual" as const, label: "Transcript File", color: SP_COLORS.transcript_sharepoint.actual },
];

// ── Screen-fail helpers (shared pattern with Day Tracker) ─────────────────────

const SCREEN_FAIL_REASON_LABELS: Record<string, string> = {
    "1": "Does not meet inclusion / meets exclusion criteria",
    "2": "Moved out of area",
    "3": "No response to outreach attempts / unable to locate",
    "4": "Administrative constraints",
    "5": "Incarceration",
    "6": "Long-term hospitalization",
    "7": "Subject formally withdrew",
    "8": "Medical event precluded participation",
    "9": "Death",
    "10": "Other",
};

const getScreenFailBadge = (reasonCode: string | null) => {
    const trimmed = (reasonCode ?? "").trim();
    const label = SCREEN_FAIL_REASON_LABELS[trimmed] ?? null;
    return {
        badgeText: trimmed || "SF",
        title: `Screen failed\nSource: formsdb.forms.redcap_forms\n${trimmed ? `Reason: ${trimmed}${label ? ` — ${label}` : ""}` : "Reason not recorded"}`,
    };
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const asReadableDate = (value: string | null | undefined): string => {
    if (!value) return "N/A";
    const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
        const [, y, m, d] = match;
        return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "2-digit",
        });
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "N/A";
    return parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
};

const asFileName = (value: string | null | undefined): string => {
    if (!value) return "N/A";
    const parts = value.replace(/\\/g, "/").split("/").filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : value;
};

const parseDateToUtcMillis = (value: string | null | undefined): number | null => {
    if (!value) return null;
    const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const [, y, m, d] = match;
    return Date.UTC(Number(y), Number(m) - 1, Number(d));
};

const diffDays = (fromDate: string, toDate: string): number | null => {
    const fromMs = parseDateToUtcMillis(fromDate);
    const toMs = parseDateToUtcMillis(toDate);
    if (fromMs === null || toMs === null) return null;
    return Math.round((fromMs - toMs) / (24 * 60 * 60 * 1000));
};

// ── Dataflow status computation ────────────────────────────────────────────────

function getModalityStatus(
    subject: SharePointPayload["subjects"][number],
    modalityKey: string,
    runSheetFormToModality: Record<string, string>,
    runSheetForms: string[],
    jsonRequiredByModality: Record<string, boolean | null>
) {
    const jsonRequired = jsonRequiredByModality[modalityKey] !== false;

    const hasJsonRaw = subject.days.some(
        (d) => d.modality_key === modalityKey && d.file_type === "json"
    );
    const hasJson = jsonRequired ? hasJsonRaw : null;
    const hasActual = subject.days.some(
        (d) => d.modality_key === modalityKey && d.file_type === "actual"
    );

    // Check if any run sheet forms are mapped to this modality
    const relevantForms = runSheetForms.filter(
        (f) => runSheetFormToModality[f] === modalityKey
    );
    const runSheetExpected = relevantForms.length > 0;
    const hasRunSheet = runSheetExpected
        ? subject.run_sheets.some(
              (rs) => runSheetFormToModality[rs.form_name] === modalityKey && rs.has_data
          )
        : null; // null = N/A (no form discovered)

    return { hasJson, hasActual, hasRunSheet, runSheetExpected, jsonRequired };
}

// ── Status icon ───────────────────────────────────────────────────────────────

function StatusIcon({ value, label, nullHint }: { value: boolean | null; label: string; nullHint?: string }) {
    if (value === null) {
        return (
            <Tooltip>
                <TooltipTrigger asChild>
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold bg-muted text-muted-foreground select-none">—</span>
                </TooltipTrigger>
                <TooltipContent>{nullHint ?? `${label}: no form discovered for this modality`}</TooltipContent>
            </Tooltip>
        );
    }
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <span
                    className={`inline-flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold text-white select-none ${
                        value
                            ? "bg-green-500 dark:bg-green-600"
                            : "bg-red-500 dark:bg-red-600"
                    }`}
                >
                    {value ? "✓" : "✗"}
                </span>
            </TooltipTrigger>
            <TooltipContent>{label}: {value ? "present" : "missing"}</TooltipContent>
        </Tooltip>
    );
}

// ── Subject status badges (shared with Day Tracker pattern) ───────────────────

function SubjectBadges({
    subject,
    showTooltip,
    hideTooltip,
}: {
    subject: SharePointPayload["subjects"][number];
    showTooltip: (e: React.MouseEvent<HTMLElement>, lines: string[]) => void;
    hideTooltip: () => void;
}) {
    const sfBadge = getScreenFailBadge(subject.screen_fail_reason);
    return (
        <span className="inline-flex items-center gap-1.5">
            <span className="font-medium">{subject.subject_id}</span>
            {subject.is_consented ? (
                <span
                    className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-green-500 text-[9px] font-bold text-white dark:bg-green-600"
                    onMouseEnter={(e) =>
                        showTooltip(e, [
                            "Consented",
                            "Source: lochnessdb.subjects.subject_metadata->>'consent_date'",
                            `Value: ${asReadableDate(subject.consent_date)}`,
                        ])
                    }
                    onMouseMove={(e) =>
                        showTooltip(e, [
                            "Consented",
                            "Source: lochnessdb.subjects.subject_metadata->>'consent_date'",
                            `Value: ${asReadableDate(subject.consent_date)}`,
                        ])
                    }
                    onMouseLeave={hideTooltip}
                >
                    ✓
                </span>
            ) : (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-[9px] font-bold text-white dark:bg-amber-500">!</span>
                    </TooltipTrigger>
                    <TooltipContent className="whitespace-pre-line max-w-xs">
                        {"No consent date recorded\nSource: lochnessdb.subjects.subject_metadata"}
                    </TooltipContent>
                </Tooltip>
            )}
            {subject.is_withdrawn && (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[8px] font-bold text-white dark:bg-red-600">W</span>
                    </TooltipTrigger>
                    <TooltipContent className="whitespace-pre-line max-w-xs">
                        {"Early withdrawal\nSource: formsdb.forms.redcap_forms.form_data->>'chrstatus_withdrawal'"}
                    </TooltipContent>
                </Tooltip>
            )}
            {subject.is_screen_failed && (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <span className="inline-flex h-4 min-w-5 items-center justify-center rounded-full bg-orange-600 px-1 text-[8px] font-bold text-white dark:bg-orange-700">
                            {sfBadge.badgeText}
                        </span>
                    </TooltipTrigger>
                    <TooltipContent className="whitespace-pre-line max-w-xs">{sfBadge.title}</TooltipContent>
                </Tooltip>
            )}
        </span>
    );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SharePointTrackerPage() {
    const [projectIdInput, setProjectIdInput] = React.useState("Procan");
    const [projectId, setProjectId] = React.useState("Procan");
    const [subjectFilter, setSubjectFilter] = React.useState("");
    const [data, setData] = React.useState<SharePointPayload | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [activeTab, setActiveTab] = React.useState<"dataflow" | "timeline">("dataflow");
    const [activeModalityTab, setActiveModalityTab] = React.useState<string>("all");
    const [showLast24h, setShowLast24h] = React.useState(false);
    const [expandedSubjectId, setExpandedSubjectId] = React.useState<string | null>(null);
    const [hoverTooltip, setHoverTooltip] = React.useState<{ x: number; y: number; lines: string[] } | null>(null);

    const showTooltip = React.useCallback((event: React.MouseEvent<HTMLElement>, lines: string[]) => {
        const maxX = typeof window !== "undefined" ? window.innerWidth - 340 : event.clientX + 12;
        const maxY = typeof window !== "undefined" ? window.innerHeight - 140 : event.clientY + 12;
        setHoverTooltip({
            x: Math.max(8, Math.min(event.clientX + 12, maxX)),
            y: Math.max(8, Math.min(event.clientY + 12, maxY)),
            lines,
        });
    }, []);

    const hideTooltip = React.useCallback(() => setHoverTooltip(null), []);

    const fetchData = React.useCallback(async (pid: string) => {
        setLoading(true);
        try {
            const res = await fetch(`/api/v1/sharepoint-tracker/${encodeURIComponent(pid)}`);
            if (!res.ok) throw new Error((await res.text()) || "Failed to fetch");
            setData((await res.json()) as SharePointPayload);
        } catch (err) {
            console.error(err);
            setData(null);
            toast.error("Failed to load SharePoint tracker data");
        } finally {
            setLoading(false);
        }
    }, []);

    React.useEffect(() => { fetchData(projectId); }, [projectId, fetchData]);

    // ── Modality tabs (only show those with any data) ─────────────────────────
    const modalityTabOptions = React.useMemo(() => {
        const available = new Set<SpModalityKey>(
            (data?.modality_keys ?? []).filter((k): k is SpModalityKey =>
                SHAREPOINT_MODALITIES.some((m) => m.key === k)
            )
        );
        return [
            { key: "all", label: "All" },
            ...SHAREPOINT_MODALITIES.filter((m) => available.has(m.key)),
        ];
    }, [data]);

    React.useEffect(() => {
        if (!modalityTabOptions.some((t) => t.key === activeModalityTab)) {
            setActiveModalityTab("all");
        }
    }, [activeModalityTab, modalityTabOptions]);

    // ── Filtered subjects ─────────────────────────────────────────────────────
    const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split("T")[0];

    const filteredSubjects = React.useMemo(() => {
        const norm = subjectFilter.trim().toLowerCase();
        let all = (data?.subjects ?? []).filter((s) => s.is_consented);
        if (norm) all = all.filter((s) => s.subject_id.toLowerCase().includes(norm));
        if (showLast24h) {
            all = all
                .map((s) => ({
                    ...s,
                    days: s.days.filter((d) => d.calendar_date >= cutoff24h),
                }))
                .filter((s) => s.days.length > 0);
        }
        return all;
    }, [data, subjectFilter, showLast24h, cutoff24h]);

    // ── Incomplete subjects count (for summary banner) ─────────────────────────
    const incompleteCount = React.useMemo(() => {
        if (!data) return 0;
        return filteredSubjects.filter((subject) => {
            if (subject.is_screen_failed) return false; // screen-failed not expected to complete
            for (const m of SHAREPOINT_MODALITIES) {
                if (!data.modality_keys.includes(m.key)) continue;
                const s = getModalityStatus(subject, m.key, data.run_sheet_form_to_modality, data.run_sheet_forms, data.metadata.json_required_by_modality ?? {});
                if ((s.jsonRequired && !s.hasJson) || !s.hasActual) return true;
                if (s.runSheetExpected && !s.hasRunSheet) return true;
            }
            return false;
        }).length;
    }, [data, filteredSubjects]);

    // ── Visible modalities based on active tab ────────────────────────────────
    const visibleModalities = React.useMemo(
        () =>
            activeModalityTab === "all"
                ? SHAREPOINT_MODALITIES.filter((m) =>
                      data?.modality_keys.includes(m.key)
                  )
                : SHAREPOINT_MODALITIES.filter((m) => m.key === activeModalityTab),
        [activeModalityTab, data]
    );

    // ── Timeline anchored on Day 1a (Pre-dose), falling back to consent date ──
    // When Day 1a date is available, offsets are relative to it (Day 0 = Day 1a).
    // When unavailable, falls back to consent-date-based day_offset from the backend.
    const timelineBySubject = React.useMemo(() => {
        type TPoint = { day_offset: number; calendar_date: string; modality_key: string; file_type: "json" | "actual"; unique_file_count: number; file_paths: string[] };
        const map = new Map<string, { day1aDate: string | null; consentDate: string | null; anchor: "day1a" | "consent"; points: TPoint[] }>();
        for (const subject of filteredSubjects) {
            const day1aDate = subject.day1a_predose_date ?? null;
            const consentDate = subject.consent_date;
            const anchor: "day1a" | "consent" = day1aDate ? "day1a" : "consent";
            const points: TPoint[] = [];
            for (const day of subject.days) {
                if (day1aDate) {
                    const adjusted = diffDays(day.calendar_date, day1aDate);
                    if (adjusted === null) continue;
                    points.push({ day_offset: adjusted, calendar_date: day.calendar_date, modality_key: day.modality_key, file_type: day.file_type, unique_file_count: day.unique_file_count, file_paths: day.file_paths });
                } else {
                    // Fallback: use consent-based offset already computed by backend
                    points.push({ day_offset: day.day_offset, calendar_date: day.calendar_date, modality_key: day.modality_key, file_type: day.file_type, unique_file_count: day.unique_file_count, file_paths: day.file_paths });
                }
            }
            map.set(subject.subject_id, { day1aDate, consentDate, anchor, points });
        }
        return map;
    }, [filteredSubjects]);

    // ── Timeline range ────────────────────────────────────────────────────────
    const dayOffsetRange = React.useMemo(() => {
        let min = 0;
        let max = 0;
        for (const subject of filteredSubjects) {
            const timeline = timelineBySubject.get(subject.subject_id);
            for (const d of timeline?.points ?? []) {
                if (d.day_offset < min) min = d.day_offset;
                if (d.day_offset > max) max = d.day_offset;
            }
            // Include reference date so it's never clipped off-screen
            if (timeline?.anchor === "day1a" && timeline.day1aDate && timeline.consentDate) {
                const consentOffset = diffDays(timeline.consentDate, timeline.day1aDate);
                if (consentOffset !== null) {
                    if (consentOffset < min) min = consentOffset;
                    if (consentOffset > max) max = consentOffset;
                }
            }
            if (timeline?.anchor === "consent" && timeline.consentDate && timeline.day1aDate) {
                const day1aOffset = diffDays(timeline.day1aDate, timeline.consentDate);
                if (day1aOffset !== null) {
                    if (day1aOffset < min) min = day1aOffset;
                    if (day1aOffset > max) max = day1aOffset;
                }
            }
        }
        return { min, max };
    }, [filteredSubjects, timelineBySubject]);

    const RANGE_PADDING = 5;
    const paddedMin = dayOffsetRange.min - RANGE_PADDING;
    const paddedMax = dayOffsetRange.max + RANGE_PADDING;
    const rangeSpan = Math.max(1, paddedMax - paddedMin);
    const toXPct = React.useCallback(
        (offset: number) => ((offset - paddedMin) / rangeSpan) * 100,
        [paddedMin, rangeSpan]
    );
    const AXIS_TICKS = [-30, 0, 30, 60, 90, 180, 365];
    const visibleTicks = AXIS_TICKS.filter((t) => t >= paddedMin && t <= paddedMax);

    const maxBucketTotal = React.useMemo(() => {
        let max = 1;
        for (const subject of filteredSubjects) {
            const timeline = timelineBySubject.get(subject.subject_id);
            for (const d of timeline?.points ?? []) {
                const inSeries =
                    activeModalityTab === "all" || d.modality_key === activeModalityTab;
                if (inSeries && d.unique_file_count > max) max = d.unique_file_count;
            }
        }
        return max;
    }, [filteredSubjects, activeModalityTab, timelineBySubject]);

    // ── Visible SP_SERIES for timeline ────────────────────────────────────────
    const visibleSeries = React.useMemo(
        () =>
            SP_SERIES.filter(
                (s) =>
                    (activeModalityTab === "all" || s.key === activeModalityTab) &&
                    data?.modality_keys.includes(s.key)
            ),
        [activeModalityTab, data]
    );

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div className="container mx-auto flex max-w-6xl flex-col gap-6 p-6">
            <Heading icon={<CloudUpload className="h-8 w-8" />} title="SharePoint Tracker" />
            <p className="text-sm text-muted-foreground -mt-4">
                Per-subject dataflow status for SharePoint modalities — EEG, MindLAMP QC, and Transcript
            </p>

            {/* Controls */}
            <div className="border rounded-lg p-4 bg-card text-card-foreground">
                <div className="flex flex-col md:flex-row md:items-end gap-3">
                    <div className="flex-1">
                        <label htmlFor="sp-project-id" className="text-sm font-medium block mb-1">Project ID</label>
                        <Input
                            id="sp-project-id"
                            value={projectIdInput}
                            onChange={(e) => setProjectIdInput(e.target.value)}
                            placeholder="Enter project ID"
                            onKeyDown={(e) => { if (e.key === "Enter" && projectIdInput.trim()) setProjectId(projectIdInput.trim()); }}
                        />
                    </div>
                    <div className="flex-1">
                        <label htmlFor="sp-subject-filter" className="text-sm font-medium block mb-1">Filter by Subject ID</label>
                        <Input
                            id="sp-subject-filter"
                            value={subjectFilter}
                            onChange={(e) => setSubjectFilter(e.target.value)}
                            placeholder="Filter by subject ID…"
                        />
                    </div>
                    <Button
                        type="button"
                        onClick={() => setProjectId(projectIdInput.trim())}
                        disabled={!projectIdInput.trim() || loading}
                        className="gap-2"
                    >
                        <RefreshCcw className="h-4 w-4" />
                        Load
                    </Button>
                </div>
                <div className="flex items-center gap-2 pt-1">
                    <Switch
                        id="sp-last24h"
                        checked={showLast24h}
                        onCheckedChange={setShowLast24h}
                    />
                    <label htmlFor="sp-last24h" className="text-sm font-medium cursor-pointer select-none">
                        Last 24 hours only
                    </label>
                    {showLast24h && (
                        <span className="text-xs text-muted-foreground">
                            — data pulled on or after {new Date(Date.now() - 24 * 60 * 60 * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                        </span>
                    )}
                </div>
            </div>

            {loading ? (
                <div className="border rounded-lg p-6 bg-card text-card-foreground text-sm text-muted-foreground">
                    Loading SharePoint tracker…
                </div>
            ) : !data ? (
                <div className="border rounded-lg p-6 bg-card text-card-foreground text-sm text-muted-foreground">
                    SharePoint tracker data is unavailable.
                </div>
            ) : (
                <>
                    {/* View selector */}
                    <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "dataflow" | "timeline")} className="w-full">
                        <TabsList>
                            <TabsTrigger value="dataflow">Dataflow Status</TabsTrigger>
                            <TabsTrigger value="timeline">Timeline</TabsTrigger>
                        </TabsList>
                    </Tabs>

                    {/* Summary banner */}
                    <div className={`-mt-3 flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 text-sm ${
                        incompleteCount > 0
                            ? "border-amber-300 bg-amber-50/60 text-amber-800 dark:bg-amber-900/20 dark:text-amber-200 dark:border-amber-700"
                            : "border-green-300 bg-green-50/60 text-green-800 dark:bg-green-900/20 dark:text-green-200 dark:border-green-700"
                    }`}>
                        <span>
                            {incompleteCount > 0
                                ? `⚠ ${incompleteCount} of ${filteredSubjects.length} participant${filteredSubjects.length === 1 ? "" : "s"} have incomplete SharePoint dataflow`
                                : `✓ All ${filteredSubjects.length} participant${filteredSubjects.length === 1 ? "" : "s"} have complete SharePoint dataflow`}
                        </span>
                        <span className="text-xs text-muted-foreground">
                            {filteredSubjects.length} of {data.subjects.length} shown
                        </span>
                        {data.run_sheet_forms.length > 0 && (
                            <span className="text-xs text-muted-foreground">
                                Run sheet forms: {data.run_sheet_forms.join(", ")}
                            </span>
                        )}
                    </div>

                    {/* ── Dataflow Status tab ──────────────────────────────── */}
                    {activeTab === "dataflow" && (
                        <section className="border rounded-lg p-4 bg-card text-card-foreground">
                            <div className="mb-3">
                                <h2 className="text-base font-semibold">Dataflow Status</h2>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    Per-subject presence check: JSON file · Actual file · REDCap run sheet.
                                    Run sheets discovered dynamically from formsdb.
                                </p>
                            </div>

                            {/* Modality sub-tabs */}
                            <Tabs value={activeModalityTab} onValueChange={setActiveModalityTab} className="w-full mb-4">
                                <TabsList className="flex h-auto flex-wrap justify-start gap-2">
                                    {modalityTabOptions.map((tab) => (
                                        <TabsTrigger key={tab.key} value={tab.key}>
                                            <span className="inline-flex items-center gap-2">
                                                {tab.key !== "all" && (
                                                    <span
                                                        className="h-2 w-2 rounded-full border border-black/10"
                                                        style={{ backgroundColor: SP_COLORS[tab.key as SpModalityKey]?.json }}
                                                        aria-hidden="true"
                                                    />
                                                )}
                                                <span>{tab.label}</span>
                                            </span>
                                        </TabsTrigger>
                                    ))}
                                </TabsList>
                            </Tabs>

                            {/* Legend */}
                            <div className="mb-3 flex flex-wrap items-center gap-4 text-[11px] text-muted-foreground">
                                <span className="inline-flex items-center gap-1">
                                    <span className="inline-flex h-4 w-4 items-center justify-center rounded text-[10px] font-bold bg-green-500 text-white">✓</span>
                                    Present
                                </span>
                                <span className="inline-flex items-center gap-1">
                                    <span className="inline-flex h-4 w-4 items-center justify-center rounded text-[10px] font-bold bg-red-500 text-white">✗</span>
                                    Missing
                                </span>
                                <span className="inline-flex items-center gap-1">
                                    <span className="inline-flex h-4 w-4 items-center justify-center rounded text-[10px] font-bold bg-muted text-muted-foreground">—</span>
                                    N/A (no form)
                                </span>
                                <span className="text-[11px]">J = JSON file · F = Actual file · R = Run sheet</span>
                            </div>

                            {filteredSubjects.length === 0 ? (
                                <p className="text-sm text-muted-foreground">No participants match the current filter.</p>
                            ) : visibleModalities.length === 0 ? (
                                <p className="text-sm text-muted-foreground">No SharePoint data found for this modality.</p>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full border-collapse text-[11px]">
                                        <thead>
                                            <tr>
                                                <th className="sticky left-0 z-10 min-w-[180px] border border-border bg-muted px-2 py-1.5 text-left font-semibold text-xs">
                                                    Participant
                                                </th>
                                                {visibleModalities.map((m) => (
                                                    <th
                                                        key={m.key}
                                                        colSpan={3}
                                                        className="min-w-[120px] border border-border bg-muted px-2 py-1.5 text-center font-semibold"
                                                    >
                                                        <span className="inline-flex items-center gap-1.5">
                                                            <span
                                                                className="h-2 w-2 rounded-full border border-black/10"
                                                                style={{ backgroundColor: SP_COLORS[m.key]?.json }}
                                                                aria-hidden="true"
                                                            />
                                                            {m.label}
                                                        </span>
                                                    </th>
                                                ))}
                                            </tr>
                                            <tr>
                                                <th className="sticky left-0 z-10 border border-border bg-muted/60 px-2 py-0.5 text-left" />
                                                {visibleModalities.map((m) => (
                                                    <React.Fragment key={m.key}>
                                                        <th className="border border-border bg-muted/60 px-1 py-0.5 text-center text-[10px] font-medium text-muted-foreground">J</th>
                                                        <th className="border border-border bg-muted/60 px-1 py-0.5 text-center text-[10px] font-medium text-muted-foreground">F</th>
                                                        <th className="border border-border bg-muted/60 px-1 py-0.5 text-center text-[10px] font-medium text-muted-foreground">R</th>
                                                    </React.Fragment>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filteredSubjects.map((subject) => {
                                                const isExpanded = expandedSubjectId === subject.subject_id;
                                                // Determine if any modality is incomplete for this subject
                                                const isIncomplete = !subject.is_screen_failed && visibleModalities.some((m) => {
                                                    const s = getModalityStatus(subject, m.key, data.run_sheet_form_to_modality, data.run_sheet_forms, data.metadata.json_required_by_modality ?? {});
                                                    return (s.jsonRequired && !s.hasJson) || !s.hasActual || (s.runSheetExpected && !s.hasRunSheet);
                                                });
                                                const colSpan = visibleModalities.length * 3 + 1;

                                                return (
                                                    <React.Fragment key={subject.subject_id}>
                                                        <tr
                                                            className={`cursor-pointer hover:bg-muted/40 ${isExpanded ? "bg-muted/30" : ""} ${isIncomplete ? "bg-amber-50/40 dark:bg-amber-900/10" : ""}`}
                                                            onClick={() => setExpandedSubjectId(isExpanded ? null : subject.subject_id)}
                                                        >
                                                            <td className="sticky left-0 z-10 border border-border bg-card px-2 py-1.5">
                                                                <SubjectBadges
                                                                    subject={subject}
                                                                    showTooltip={showTooltip}
                                                                    hideTooltip={hideTooltip}
                                                                />
                                                                <span className="block text-[9px] text-muted-foreground/50 select-none mt-0.5">
                                                                    {isExpanded ? "▲ collapse" : "▼ expand"}
                                                                </span>
                                                            </td>
                                                            {visibleModalities.map((m) => {
                                                                const s = getModalityStatus(subject, m.key, data.run_sheet_form_to_modality, data.run_sheet_forms, data.metadata.json_required_by_modality ?? {});
                                                                return (
                                                                    <React.Fragment key={m.key}>
                                                                        <td className="border border-border px-1 py-1 text-center">
                                                                            <StatusIcon
                                                                                value={s.hasJson}
                                                                                label="JSON file"
                                                                                nullHint={s.jsonRequired ? undefined : "JSON file: not required by source configuration"}
                                                                            />
                                                                        </td>
                                                                        <td className="border border-border px-1 py-1 text-center">
                                                                            <StatusIcon value={s.hasActual} label="Actual file" />
                                                                        </td>
                                                                        <td className="border border-border px-1 py-1 text-center">
                                                                            <StatusIcon value={s.hasRunSheet} label="Run sheet" />
                                                                        </td>
                                                                    </React.Fragment>
                                                                );
                                                            })}
                                                        </tr>
                                                        {isExpanded && (
                                                            <tr>
                                                                <td colSpan={colSpan} className="border border-border bg-muted/20 p-3">
                                                                    <p className="text-xs font-semibold mb-2">
                                                                        {subject.subject_id} — detail
                                                                        {subject.consent_date && (
                                                                            <span className="ml-2 font-normal text-muted-foreground">
                                                                                Consent: {asReadableDate(subject.consent_date)}
                                                                            </span>
                                                                        )}
                                                                        {subject.day1a_predose_date && (
                                                                            <span className="ml-2 font-normal text-muted-foreground">
                                                                                Day 1a: {asReadableDate(subject.day1a_predose_date)}
                                                                            </span>
                                                                        )}
                                                                    </p>
                                                                    {/* File list */}
                                                                    {subject.days.length > 0 && (
                                                                        <div className="mb-3 overflow-x-auto">
                                                                            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">SharePoint Files</p>
                                                                            <table className="w-full border-collapse text-[11px]">
                                                                                <thead>
                                                                                    <tr>
                                                                                        <th className="border border-border bg-muted px-2 py-1 text-left">Date</th>
                                                                                        <th className="border border-border bg-muted px-2 py-1 text-left">Day from Consent</th>
                                                                                        <th className="border border-border bg-muted px-2 py-1 text-left">Modality</th>
                                                                                        <th className="border border-border bg-muted px-2 py-1 text-left">Type</th>
                                                                                        <th className="border border-border bg-muted px-2 py-1 text-left">Files</th>
                                                                                        <th className="border border-border bg-muted px-2 py-1 text-left">File list</th>
                                                                                    </tr>
                                                                                </thead>
                                                                                <tbody>
                                                                                    {[...subject.days]
                                                                                        .filter((d) =>
                                                                                            activeModalityTab === "all" ||
                                                                                            d.modality_key === activeModalityTab
                                                                                        )
                                                                                        .sort((a, b) => a.day_offset - b.day_offset)
                                                                                        .map((day, idx) => {
                                                                                            const seriesColor =
                                                                                                SP_COLORS[day.modality_key as SpModalityKey]?.[day.file_type] ?? "#aaa";
                                                                                            return (
                                                                                                <tr key={idx} className="hover:bg-muted/30">
                                                                                                    <td className="border border-border px-2 py-1 whitespace-nowrap">{asReadableDate(day.calendar_date)}</td>
                                                                                                    <td className="border border-border px-2 py-1 whitespace-nowrap">
                                                                                                        {day.day_offset >= 0 ? "+" : ""}{day.day_offset}
                                                                                                    </td>
                                                                                                    <td className="border border-border px-2 py-1">
                                                                                                        <span
                                                                                                            className="inline-block rounded px-1.5 py-0.5 text-white text-[10px] font-medium"
                                                                                                            style={{ backgroundColor: seriesColor }}
                                                                                                        >
                                                                                                            {SHAREPOINT_MODALITIES.find((m) => m.key === day.modality_key)?.label ?? day.modality_key}
                                                                                                        </span>
                                                                                                    </td>
                                                                                                    <td className="border border-border px-2 py-1 text-muted-foreground uppercase text-[10px]">{day.file_type}</td>
                                                                                                    <td className="border border-border px-2 py-1">{day.unique_file_count}</td>
                                                                                                    <td className="border border-border px-2 py-1 max-w-[220px]">
                                                                                                        {day.file_paths.length > 0 ? (
                                                                                                            <Tooltip>
                                                                                                                <TooltipTrigger asChild>
                                                                                                                    <span className="block truncate">{day.file_paths.slice(0, 2).map(asFileName).join(", ")}{day.file_paths.length > 2 ? ` +${day.file_paths.length - 2}` : ""}</span>
                                                                                                                </TooltipTrigger>
                                                                                                                <TooltipContent className="max-w-xs break-all whitespace-pre-line">
                                                                                                                    {day.file_paths.join("\n")}
                                                                                                                </TooltipContent>
                                                                                                            </Tooltip>
                                                                                                        ) : "—"}
                                                                                                    </td>
                                                                                                </tr>
                                                                                            );
                                                                                        })}
                                                                                </tbody>
                                                                            </table>
                                                                        </div>
                                                                    )}
                                                                    {/* Run sheets */}
                                                                    {subject.run_sheets.length > 0 && (
                                                                        <div className="overflow-x-auto">
                                                                            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">REDCap Run Sheets — Session Details</p>
                                                                            <table className="w-full border-collapse text-[11px]">
                                                                                <thead>
                                                                                    <tr>
                                                                                        <th className="border border-border bg-muted px-2 py-1 text-left">Form</th>
                                                                                        <th className="border border-border bg-muted px-2 py-1 text-left">REDCap Event</th>
                                                                                        <th className="border border-border bg-muted px-2 py-1 text-left">
                                                                                            <Tooltip>
                                                                                                <TooltipTrigger asChild>
                                                                                                    <span className="cursor-help border-b border-dotted">Instance #</span>
                                                                                                </TooltipTrigger>
                                                                                                <TooltipContent>
                                                                                                    <p className="max-w-xs text-xs">REDCap repeating instrument instance number. <strong>—</strong> means the form is non-repeating — one row per event arm is expected.</p>
                                                                                                </TooltipContent>
                                                                                            </Tooltip>
                                                                                        </th>
                                                                                        <th className="border border-border bg-muted px-2 py-1 text-left">
                                                                                            <Tooltip>
                                                                                                <TooltipTrigger asChild>
                                                                                                    <span className="cursor-help border-b border-dotted">Session Date</span>
                                                                                                </TooltipTrigger>
                                                                                                <TooltipContent>
                                                                                                    <p className="max-w-xs text-xs">Source: <code>*_interview_date</code> field (e.g. <code>chreeg_interview_date</code>, <code>chrdig_interview_date</code>, <code>chrav_interview_date</code>). The date the session was conducted.</p>
                                                                                                </TooltipContent>
                                                                                            </Tooltip>
                                                                                        </th>
                                                                                        <th className="border border-border bg-muted px-2 py-1 text-left">Day from Consent</th>
                                                                                        <th className="border border-border bg-muted px-2 py-1 text-left">
                                                                                            <Tooltip>
                                                                                                <TooltipTrigger asChild>
                                                                                                    <span className="cursor-help border-b border-dotted">Performed</span>
                                                                                                </TooltipTrigger>
                                                                                                <TooltipContent>
                                                                                                    <p className="max-w-xs text-xs">*_performed field: 1=Yes, 0=No. Indicates whether the session was actually conducted.</p>
                                                                                                </TooltipContent>
                                                                                            </Tooltip>
                                                                                        </th>
                                                                                        <th className="border border-border bg-muted px-2 py-1 text-left">RA</th>
                                                                                        <th className="border border-border bg-muted px-2 py-1 text-left">User</th>
                                                                                        <th className="border border-border bg-muted px-2 py-1 text-left">Start → End</th>
                                                                                        <th className="border border-border bg-muted px-2 py-1 text-left">
                                                                                            <Tooltip>
                                                                                                <TooltipTrigger asChild>
                                                                                                    <span className="cursor-help border-b border-dotted">Runs / Upload</span>
                                                                                                </TooltipTrigger>
                                                                                                <TooltipContent>
                                                                                                    <p className="max-w-xs text-xs">EEG: runs completed out of total. Transcript: NSI/Psychs upload status.</p>
                                                                                                </TooltipContent>
                                                                                            </Tooltip>
                                                                                        </th>
                                                                                        <th className="border border-border bg-muted px-2 py-1 text-left">
                                                                                            <Tooltip>
                                                                                                <TooltipTrigger asChild>
                                                                                                    <span className="cursor-help border-b border-dotted">Status</span>
                                                                                                </TooltipTrigger>
                                                                                                <TooltipContent>
                                                                                                    <p className="max-w-xs text-xs">REDCap completion code: 0=Incomplete, 1=Unverified, 2=Complete</p>
                                                                                                </TooltipContent>
                                                                                            </Tooltip>
                                                                                        </th>
                                                                                        <th className="border border-border bg-muted px-2 py-1 text-left">
                                                                                            <Tooltip>
                                                                                                <TooltipTrigger asChild>
                                                                                                    <span className="cursor-help border-b border-dotted">SP Form Date</span>
                                                                                                </TooltipTrigger>
                                                                                                <TooltipContent>
                                                                                                    <div className="max-w-xs text-xs">
                                                                                                        <p className="font-semibold mb-1">SharePoint Form Submission Date</p>
                                                                                                        <p>Date from <code>response.submitted.json</code> (<code>sharepoint.sharepoint_forms.form_data-&gt;&gt;&apos;event_date&apos;</code>). Should match the run sheet Session Date.</p>
                                                                                                    </div>
                                                                                                </TooltipContent>
                                                                                            </Tooltip>
                                                                                        </th>
                                                                                        <th className="border border-border bg-muted px-2 py-1 text-left">
                                                                                            <Tooltip>
                                                                                                <TooltipTrigger asChild>
                                                                                                    <span className="cursor-help border-b border-dotted">Date Check</span>
                                                                                                </TooltipTrigger>
                                                                                                <TooltipContent>
                                                                                                    <div className="max-w-xs text-xs">
                                                                                                        <p className="font-semibold mb-1">Date Discrepancy Check</p>
                                                                                                        <p>Alerts if run sheet session date differs from related SharePoint file dates by &gt;1 day.</p>
                                                                                                    </div>
                                                                                                </TooltipContent>
                                                                                            </Tooltip>
                                                                                        </th>
                                                                                    </tr>
                                                                                </thead>
                                                                                <tbody>
                                                                                    {subject.run_sheets
                                                                                        .filter((rs) =>
                                                                                            activeModalityTab === "all" ||
                                                                                            data.run_sheet_form_to_modality[rs.form_name] === activeModalityTab
                                                                                        )
                                                                                        .map((rs, idx) => {
                                                                                            const summary = rs.form_data_summary || {};
                                                                                            const rsModality = data.run_sheet_form_to_modality[rs.form_name];
                                                                                            const fileDatesForModality = subject.days
                                                                                                .filter((d) => d.modality_key === rsModality)
                                                                                                .map((d) => d.calendar_date);
                                                                                            const hasDiscrepancy =
                                                                                                rs.completion_date &&
                                                                                                fileDatesForModality.length > 0 &&
                                                                                                !fileDatesForModality.includes(rs.completion_date) &&
                                                                                                !fileDatesForModality.some((fd) => {
                                                                                                    try {
                                                                                                        const fDate = new Date(fd);
                                                                                                        const rDate = new Date(rs.completion_date!);
                                                                                                        const diff = Math.abs(fDate.getTime() - rDate.getTime()) / (1000 * 60 * 60 * 24);
                                                                                                        return diff <= 1;
                                                                                                    } catch { return false; }
                                                                                                });
                                                                                            // Row colour: green if performed, amber if incomplete, base otherwise
                                                                                            const isPerformed = summary['performed'] === '1';
                                                                                            const isIncomplete = summary['completion'] === '0';
                                                                                            // SP Form date match check
                                                                                            const sessionDate = summary['session_date'] || rs.completion_date || null;
                                                                                            const spFormDate = summary['sp_event_date'] || null;
                                                                                            const spDateMatch = sessionDate && spFormDate ? sessionDate === spFormDate : null;
                                                                                            const rowBgColor = (spFormDate && spDateMatch === false) ? "bg-red-50/30 dark:bg-red-950/15"
                                                                                                : hasDiscrepancy ? "bg-yellow-50/50 dark:bg-yellow-900/20"
                                                                                                : isPerformed ? "bg-green-50/30 dark:bg-green-950/15"
                                                                                                : isIncomplete ? "" : "";
                                                                                            // Runs / upload info
                                                                                            const runsInfo = summary['runs'] || null;
                                                                                            const uploadInfo = summary['nsi_upload'] || summary['psychs_upload']
                                                                                                ? `NSI:${summary['nsi_upload'] ?? '—'} Psychs:${summary['psychs_upload'] ?? '—'}`
                                                                                                : null;
                                                                                            const eegExtra = summary['cap_size'] || summary['head_cir']
                                                                                                ? `Cap:${summary['cap_size'] ?? '—'} Hd:${summary['head_cir'] ?? '—'}`
                                                                                                : null;
                                                                                            return (
                                                                                                <tr key={idx} className={`hover:bg-muted/30 ${rowBgColor}`}>
                                                                                                    <td className="border border-border px-2 py-1 font-mono text-[10px]">{rs.form_name}</td>
                                                                                                    <td className="border border-border px-2 py-1">{rs.redcap_event_name ?? "—"}</td>
                                                                                                    <td className="border border-border px-2 py-1 text-muted-foreground">{rs.form_instance_number ?? "—"}</td>
                                                                                                    <td className={`border border-border px-2 py-1 whitespace-nowrap${spDateMatch === true ? ' text-green-600 dark:text-green-400 font-medium' : ''}`}>
                                                                                                        {(() => { const d = summary['session_date'] || rs.completion_date; return d ? (
                                                                                                            <Tooltip>
                                                                                                                <TooltipTrigger asChild><span className="cursor-default">{spDateMatch === true ? '✓ ' : ''}{asReadableDate(d)}</span></TooltipTrigger>
                                                                                                                <TooltipContent><p className="text-xs"><code>*_interview_date</code>: {d}</p></TooltipContent>
                                                                                                            </Tooltip>
                                                                                                        ) : <span className="text-muted-foreground">—</span>; })()}
                                                                                                    </td>
                                                                                                    <td className="border border-border px-2 py-1 whitespace-nowrap">{rs.day_offset !== null ? `${rs.day_offset >= 0 ? "+" : ""}${rs.day_offset}` : "—"}</td>
                                                                                                    <td className="border border-border px-2 py-1 whitespace-nowrap">
                                                                                                        {summary['performed'] !== undefined ? (
                                                                                                            <span className={summary['performed'] === '1' ? 'text-green-600 dark:text-green-400 font-medium' : 'text-red-600 dark:text-red-400'}>
                                                                                                                {summary['performed'] === '1' ? '✓ Yes' : '✗ No'}
                                                                                                            </span>
                                                                                                        ) : <span className="text-muted-foreground">—</span>}
                                                                                                    </td>
                                                                                                    <td className="border border-border px-2 py-1 whitespace-nowrap font-medium">{summary['technician'] || <span className="text-muted-foreground">—</span>}</td>
                                                                                                    <td className="border border-border px-2 py-1 whitespace-nowrap font-mono text-[10px]">{summary['redcap_user'] || <span className="text-muted-foreground">—</span>}</td>
                                                                                                    <td className="border border-border px-2 py-1 whitespace-nowrap font-mono text-[10px]">
                                                                                                        {summary['start_time'] || summary['end_time'] ? (
                                                                                                            <span>{summary['start_time'] ?? '—'}{summary['end_time'] ? ` → ${summary['end_time']}` : ''}</span>
                                                                                                        ) : <span className="text-muted-foreground">—</span>}
                                                                                                    </td>
                                                                                                    <td className="border border-border px-2 py-1 whitespace-nowrap text-[10px]">
                                                                                                        {runsInfo ? (
                                                                                                            <Tooltip>
                                                                                                                <TooltipTrigger asChild>
                                                                                                                    <span className="font-medium cursor-help">{runsInfo} runs{eegExtra ? ` · ${eegExtra}` : ''}</span>
                                                                                                                </TooltipTrigger>
                                                                                                                <TooltipContent>EEG runs completed / total recorded. {eegExtra ?? ''}</TooltipContent>
                                                                                                            </Tooltip>
                                                                                                        ) : uploadInfo ? (
                                                                                                            <span>{uploadInfo}</span>
                                                                                                        ) : <span className="text-muted-foreground">—</span>}
                                                                                                    </td>
                                                                                                    <td className="border border-border px-2 py-1 whitespace-nowrap font-mono">
                                                                                                        {summary['completion'] ? (
                                                                                                            <span className={
                                                                                                                summary['completion'] === '2' ? 'text-green-600 dark:text-green-400' :
                                                                                                                summary['completion'] === '1' ? 'text-amber-600 dark:text-amber-400' :
                                                                                                                'text-muted-foreground'
                                                                                                            } title="REDCap completion code: 0=Incomplete, 1=Unverified, 2=Complete">
                                                                                                                {summary['completion'] === '2' ? '✓ Complete' : summary['completion'] === '1' ? '~ Unverified' : '○ Incomplete'}
                                                                                                            </span>
                                                                                                        ) : <span className="text-muted-foreground">—</span>}
                                                                                                    </td>
                                                                                                    <td className="border border-border px-2 py-1 whitespace-nowrap">
                                                                                                        {spFormDate ? (
                                                                                                            <Tooltip>
                                                                                                                <TooltipTrigger asChild>
                                                                                                                    <span className={`cursor-default inline-flex items-center gap-1 ${spDateMatch === true ? 'text-green-600 dark:text-green-400' : spDateMatch === false ? 'text-red-600 dark:text-red-400' : ''}`}>
                                                                                                                        {spDateMatch === true ? '✓ ' : spDateMatch === false ? '✗ ' : ''}{asReadableDate(spFormDate)}
                                                                                                                    </span>
                                                                                                                </TooltipTrigger>
                                                                                                                <TooltipContent>
                                                                                                                    <div className="max-w-xs text-xs">
                                                                                                                        <p className="font-semibold">SharePoint Form Date</p>
                                                                                                                        <p><code>event_date</code>: {spFormDate}</p>
                                                                                                                        {sessionDate && <p>Run sheet date: {sessionDate}</p>}
                                                                                                                        {spDateMatch === true && <p className="text-green-600 dark:text-green-400 mt-1">✓ Dates match</p>}
                                                                                                                        {spDateMatch === false && <p className="text-red-500 mt-1">✗ Date mismatch</p>}
                                                                                                                    </div>
                                                                                                                </TooltipContent>
                                                                                                            </Tooltip>
                                                                                                        ) : <span className="text-muted-foreground">—</span>}
                                                                                                    </td>
                                                                                                    <td className="border border-border px-2 py-1">
                                                                                                        {hasDiscrepancy ? (
                                                                                                            <span className="inline-block rounded px-1.5 py-0.5 text-[10px] font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-200" title="Run sheet date differs from file pull dates">⚠ Mismatch</span>
                                                                                                        ) : rs.completion_date && fileDatesForModality.length > 0 ? (
                                                                                                            <span className="text-green-600 dark:text-green-400 text-[10px]">✓ Aligned</span>
                                                                                                        ) : (
                                                                                                            <span className="text-muted-foreground text-[10px]">—</span>
                                                                                                        )}
                                                                                                    </td>
                                                                                                </tr>
                                                                                            );
                                                                                        })}
                                                                                </tbody>
                                                                            </table>
                                                                        </div>
                                                                    )}
                                                                    {subject.days.length === 0 && subject.run_sheets.length === 0 && (
                                                                        <p className="text-xs text-muted-foreground">No SharePoint data or run sheets found for this participant.</p>
                                                                    )}
                                                                </td>
                                                            </tr>
                                                        )}
                                                    </React.Fragment>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </section>
                    )}

                    {/* ── Timeline tab ─────────────────────────────────────── */}
                    {activeTab === "timeline" && (
                        <section className="border rounded-lg p-4 bg-card text-card-foreground">
                            <div className="mb-3">
                                <h2 className="text-base font-semibold">SharePoint File Timeline — Days from Consent / Day 1a (Pre-dose)</h2>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    X-axis = calendar days relative to Day 1a (Pre-dose) when available, otherwise from consent date.
                                    Bar height = file count. Colours: lighter shade = JSON file, darker = actual file.
                                    Reference lines mark Day 0 anchor (red) and the other date when they differ (green).
                                </p>
                            </div>

                            {/* Modality sub-tabs */}
                            <Tabs value={activeModalityTab} onValueChange={setActiveModalityTab} className="w-full mb-4">
                                <TabsList className="flex h-auto flex-wrap justify-start gap-2">
                                    {modalityTabOptions.map((tab) => (
                                        <TabsTrigger key={tab.key} value={tab.key}>
                                            <span className="inline-flex items-center gap-2">
                                                {tab.key !== "all" && (
                                                    <span
                                                        className="h-2 w-2 rounded-full border border-black/10"
                                                        style={{ backgroundColor: SP_COLORS[tab.key as SpModalityKey]?.json }}
                                                        aria-hidden="true"
                                                    />
                                                )}
                                                <span>{tab.label}</span>
                                            </span>
                                        </TabsTrigger>
                                    ))}
                                </TabsList>
                            </Tabs>

                            {/* Series legend */}
                            {visibleSeries.length > 0 && (
                                <div className="mb-4 flex flex-wrap gap-x-4 gap-y-2 text-[11px] text-muted-foreground">
                                    {visibleSeries.map((s) => (
                                        <span key={`${s.key}-${s.fileType}`} className="inline-flex items-center gap-1.5">
                                            <span
                                                className="h-2.5 w-2.5 rounded-sm border border-black/10 shrink-0"
                                                style={{ backgroundColor: s.color }}
                                                aria-hidden="true"
                                            />
                                            <span>{s.label}</span>
                                        </span>
                                    ))}
                                    <span className="inline-flex items-center gap-1 ml-2">
                                        <span className="inline-block w-4 border-0 border-t border-dashed border-red-400" />
                                        Day 0 anchor (Day 1a or Consent)
                                    </span>
                                    <span className="inline-flex items-center gap-1">
                                        <span className="inline-block w-4 border-0 border-t border-dashed border-green-400" />
                                        Secondary date (if different)
                                    </span>
                                </div>
                            )}

                            {filteredSubjects.length === 0 ? (
                                <p className="text-sm text-muted-foreground">No participants match the current filter.</p>
                            ) : (
                                <>
                                    {/* X-axis labels */}
                                    {visibleTicks.length > 0 && (
                                        <div className="relative w-full mb-1 h-5 text-[10px] text-muted-foreground select-none">
                                            {visibleTicks.map((t) => (
                                                <span
                                                    key={t}
                                                    className="absolute -translate-x-1/2"
                                                    style={{ left: `${toXPct(t)}%` }}
                                                >
                                                    {t === 0 ? "Day 0" : `${t > 0 ? "+" : ""}${t}`}
                                                </span>
                                            ))}
                                        </div>
                                    )}

                                    <div className="space-y-3">
                                        {filteredSubjects.map((subject) => {
                                            const timeline = timelineBySubject.get(subject.subject_id);
                                            const visibleDays = (timeline?.points ?? []).filter(
                                                (d) => activeModalityTab === "all" || d.modality_key === activeModalityTab
                                            );
                                            if (showLast24h && visibleDays.length === 0) return null;
                                            const isExpanded = expandedSubjectId === subject.subject_id;

                                            return (
                                                <div
                                                    key={subject.subject_id}
                                                    className={`border rounded-md p-3 cursor-pointer transition-colors ${isExpanded ? "border-primary/40 bg-muted/20" : "hover:border-border/80"}`}
                                                    onClick={() => setExpandedSubjectId(isExpanded ? null : subject.subject_id)}
                                                >
                                                    <div className="flex items-center gap-2 mb-0.5">
                                                        <SubjectBadges
                                                            subject={subject}
                                                            showTooltip={showTooltip}
                                                            hideTooltip={hideTooltip}
                                                        />
                                                        <span className="ml-auto text-[9px] text-muted-foreground/50 select-none">
                                                            {isExpanded ? "▲ collapse" : "▼ expand"}
                                                        </span>
                                                    </div>
                                                    <p className="text-xs text-muted-foreground mt-0.5 mb-2">
                                                        {timeline?.anchor === "day1a" ? (
                                                            <>Day 1a (Pre-dose): {asReadableDate(timeline.day1aDate)}
                                                            {timeline.consentDate && timeline.consentDate !== timeline.day1aDate && (
                                                                <> {" | "} Consent: {asReadableDate(timeline.consentDate)}{(() => { const d = diffDays(timeline.consentDate!, timeline.day1aDate!); return d !== null && d !== 0 ? ` (${d >= 0 ? "+" : ""}${d} days)` : ''; })()}</>
                                                            )}
                                                            </>
                                                        ) : (
                                                            <>Consent: {asReadableDate(timeline?.consentDate)}
                                                            {timeline?.day1aDate && (
                                                                <span className="ml-2 text-[10px] text-amber-600 dark:text-amber-400">(Day 1a not recorded — using consent as Day 0)</span>
                                                            )}
                                                            </>
                                                        )}
                                                    </p>

                                                    {visibleDays.length === 0 && !timeline?.points?.length ? (
                                                        <span className="text-xs text-muted-foreground">No SharePoint activity recorded</span>
                                                    ) : visibleDays.length === 0 ? (
                                                        <span className="text-xs text-muted-foreground">
                                                            {showLast24h ? "No data in the last 24 hours" : "No SharePoint activity recorded"}
                                                        </span>
                                                    ) : (
                                                        <div className={`relative w-full ${isExpanded ? "h-20" : "h-8"}`}>
                                                            <div className="absolute inset-0 rounded bg-muted/30" />
                                                            {/* Day 0 reference line (red dashed) + secondary date line (green dashed) */}
                                                            {(() => {
                                                                const xAnchor = toXPct(0);
                                                                // Secondary reference: consent (when day1a anchor) or day1a (when consent anchor)
                                                                const secondaryOffset = timeline?.anchor === "day1a"
                                                                    ? (timeline.day1aDate && timeline.consentDate ? diffDays(timeline.consentDate, timeline.day1aDate) : null)
                                                                    : (timeline?.consentDate && timeline?.day1aDate ? diffDays(timeline.day1aDate, timeline.consentDate) : null);
                                                                const xSecondary = secondaryOffset !== null && secondaryOffset !== undefined ? toXPct(secondaryOffset) : null;
                                                                const overlapping = xSecondary !== null && Math.abs(xSecondary - xAnchor) < 2;
                                                                const anchorLabel = timeline?.anchor === "day1a" ? "Day 1a (Pre-dose) — Day 0" : `Consent date — Day 0: ${asReadableDate(timeline?.consentDate)}`;
                                                                const secondaryLabel = timeline?.anchor === "day1a"
                                                                    ? [`Consent date: ${asReadableDate(timeline?.consentDate)}`, `Day ${(secondaryOffset ?? 0) >= 0 ? "+" : ""}${secondaryOffset} from Day 1a`]
                                                                    : [`Day 1a (Pre-dose): ${asReadableDate(timeline?.day1aDate)}`, `Day ${(secondaryOffset ?? 0) >= 0 ? "+" : ""}${secondaryOffset} from consent`];
                                                                return (
                                                                    <>
                                                                        <div
                                                                            className="absolute top-0 bottom-0 z-10 cursor-default"
                                                                            style={{
                                                                                left: `${xAnchor + (overlapping ? 1.5 : 0)}%`,
                                                                                width: "1px",
                                                                                background: "repeating-linear-gradient(to bottom, rgba(239,68,68,0.7) 0px, rgba(239,68,68,0.7) 4px, transparent 4px, transparent 8px)",
                                                                            }}
                                                                            onMouseEnter={(e) => showTooltip(e, [anchorLabel])}
                                                                            onMouseMove={(e) => showTooltip(e, [anchorLabel])}
                                                                            onMouseLeave={hideTooltip}
                                                                        />
                                                                        {xSecondary !== null && (
                                                                            <div
                                                                                className="absolute top-0 bottom-0 z-20 cursor-default"
                                                                                style={{
                                                                                    left: `${xSecondary - (overlapping ? 1.5 : 0)}%`,
                                                                                    width: "1px",
                                                                                    background: "repeating-linear-gradient(to bottom, rgba(34,197,94,0.75) 0px, rgba(34,197,94,0.75) 4px, transparent 4px, transparent 8px)",
                                                                                }}
                                                                                onMouseEnter={(e) => showTooltip(e, secondaryLabel)}
                                                                                onMouseMove={(e) => showTooltip(e, secondaryLabel)}
                                                                                onMouseLeave={hideTooltip}
                                                                            />
                                                                        )}
                                                                    </>
                                                                );
                                                            })()}
                                                            {visibleDays.map((day) => {
                                                                const xLeft = toXPct(day.day_offset);
                                                                const barW = Math.max(0.5, (1 / rangeSpan) * 100);
                                                                const hPct = Math.max(20, (day.unique_file_count / maxBucketTotal) * 100);
                                                                const seriesColor =
                                                                    SP_COLORS[day.modality_key as SpModalityKey]?.[day.file_type] ?? "#10b981";
                                                                const anchorLabel = timeline?.anchor === "day1a" ? "Day 1a" : "Consent";
                                                                const tipLines = [
                                                                    `Day ${day.day_offset >= 0 ? "+" : ""}${day.day_offset} from ${anchorLabel} (${asReadableDate(day.calendar_date)})`,
                                                                    `${SHAREPOINT_MODALITIES.find((m) => m.key === day.modality_key)?.label ?? day.modality_key} ${day.file_type === "json" ? "JSON" : "File"}: ${day.unique_file_count} file${day.unique_file_count === 1 ? "" : "s"}`,
                                                                    ...(day.file_paths.length > 0
                                                                        ? ["", ...day.file_paths.slice(0, 3).map(asFileName)]
                                                                        : []),
                                                                ];
                                                                return (
                                                                    <div
                                                                        key={`${day.modality_key}-${day.file_type}-${day.day_offset}`}
                                                                        className="absolute bottom-0 overflow-hidden rounded-sm"
                                                                        style={{
                                                                            left: `${xLeft}%`,
                                                                            width: `${barW}%`,
                                                                            height: `${hPct}%`,
                                                                            minWidth: "3px",
                                                                            backgroundColor: seriesColor,
                                                                        }}
                                                                        onMouseEnter={(e) => { e.stopPropagation(); showTooltip(e, tipLines); }}
                                                                        onMouseMove={(e) => { e.stopPropagation(); showTooltip(e, tipLines); }}
                                                                        onMouseLeave={hideTooltip}
                                                                        onClick={(e) => e.stopPropagation()}
                                                                    />
                                                                );
                                                            })}
                                                        </div>
                                                    )}

                                                    {/* Expanded detail table */}
                                                    {isExpanded && visibleDays.length > 0 && (
                                                        <div className="mt-3 overflow-x-auto" onClick={(e) => e.stopPropagation()}>
                                                            <table className="w-full border-collapse text-[11px]">
                                                                <thead>
                                                                    <tr>
                                                                        <th className="border border-border bg-muted px-2 py-1 text-left">Date</th>
                                                                        <th className="border border-border bg-muted px-2 py-1 text-left">{timeline?.anchor === "day1a" ? "Day from Day 1a" : "Day from Consent"}</th>
                                                                        <th className="border border-border bg-muted px-2 py-1 text-left">Modality</th>
                                                                        <th className="border border-border bg-muted px-2 py-1 text-left">Type</th>
                                                                        <th className="border border-border bg-muted px-2 py-1 text-left">Files</th>
                                                                        <th className="border border-border bg-muted px-2 py-1 text-left">File list</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {[...visibleDays]
                                                                        .sort((a, b) => a.day_offset - b.day_offset)
                                                                        .map((day, idx) => {
                                                                            const seriesColor =
                                                                                SP_COLORS[day.modality_key as SpModalityKey]?.[day.file_type] ?? "#aaa";
                                                                            return (
                                                                                <tr key={idx} className="hover:bg-muted/30">
                                                                                    <td className="border border-border px-2 py-1 whitespace-nowrap">{asReadableDate(day.calendar_date)}</td>
                                                                                    <td className="border border-border px-2 py-1 whitespace-nowrap">{day.day_offset >= 0 ? "+" : ""}{day.day_offset}</td>
                                                                                    <td className="border border-border px-2 py-1">
                                                                                        <span
                                                                                            className="inline-block rounded px-1.5 py-0.5 text-white text-[10px] font-medium"
                                                                                            style={{ backgroundColor: seriesColor }}
                                                                                        >
                                                                                            {SHAREPOINT_MODALITIES.find((m) => m.key === day.modality_key)?.label ?? day.modality_key}
                                                                                        </span>
                                                                                    </td>
                                                                                    <td className="border border-border px-2 py-1 text-muted-foreground uppercase text-[10px]">{day.file_type}</td>
                                                                                    <td className="border border-border px-2 py-1">{day.unique_file_count}</td>
                                                                                    <td className="border border-border px-2 py-1 max-w-[220px]">
                                                                                        {day.file_paths.length > 0 ? (
                                                                                            <Tooltip>
                                                                                                <TooltipTrigger asChild>
                                                                                                    <span className="block truncate">
                                                                                                        {day.file_paths.slice(0, 2).map(asFileName).join(", ")}
                                                                                                        {day.file_paths.length > 2 ? ` +${day.file_paths.length - 2}` : ""}
                                                                                                    </span>
                                                                                                </TooltipTrigger>
                                                                                                <TooltipContent className="max-w-xs break-all whitespace-pre-line">
                                                                                                    {day.file_paths.join("\n")}
                                                                                                </TooltipContent>
                                                                                            </Tooltip>
                                                                                        ) : "—"}
                                                                                    </td>
                                                                                </tr>
                                                                            );
                                                                        })}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    )}

                                                    {/* Run Sheet Timeline */}
                                                    {isExpanded && subject.run_sheets.length > 0 && (
                                                        <div className="mt-3 overflow-x-auto" onClick={(e) => e.stopPropagation()}>
                                                            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Run Sheet Timeline — Session Details</p>
                                                            <table className="w-full border-collapse text-[11px]">
                                                                <thead>
                                                                    <tr>
                                                                        <th className="border border-border bg-muted px-2 py-1 text-left">Form</th>
                                                                        <th className="border border-border bg-muted px-2 py-1 text-left">REDCap Event</th>
                                                                        <th className="border border-border bg-muted px-2 py-1 text-left">
                                                                            <Tooltip>
                                                                                <TooltipTrigger asChild>
                                                                                    <span className="cursor-help border-b border-dotted">Instance #</span>
                                                                                </TooltipTrigger>
                                                                                <TooltipContent>
                                                                                    <p className="max-w-xs text-xs">REDCap repeating instrument instance number. <strong>—</strong> means the form is non-repeating — one row per event arm is expected.</p>
                                                                                </TooltipContent>
                                                                            </Tooltip>
                                                                        </th>
                                                                        <th className="border border-border bg-muted px-2 py-1 text-left">
                                                                            <Tooltip>
                                                                                <TooltipTrigger asChild>
                                                                                    <span className="cursor-help border-b border-dotted">Session Date</span>
                                                                                </TooltipTrigger>
                                                                                <TooltipContent>
                                                                                    <p className="max-w-xs text-xs">Source: <code>*_interview_date</code> field (e.g. <code>chreeg_interview_date</code>, <code>chrdig_interview_date</code>, <code>chrav_interview_date</code>). The date the session was conducted.</p>
                                                                                </TooltipContent>
                                                                            </Tooltip>
                                                                        </th>
                                                                        <th className="border border-border bg-muted px-2 py-1 text-left">Day from Consent</th>
                                                                        <th className="border border-border bg-muted px-2 py-1 text-left">
                                                                            <Tooltip>
                                                                                <TooltipTrigger asChild>
                                                                                    <span className="cursor-help border-b border-dotted">Performed</span>
                                                                                </TooltipTrigger>
                                                                                <TooltipContent>
                                                                                    <p className="max-w-xs text-xs">*_performed field: 1=Yes, 0=No. Indicates whether the session was actually conducted.</p>
                                                                                </TooltipContent>
                                                                            </Tooltip>
                                                                        </th>
                                                                        <th className="border border-border bg-muted px-2 py-1 text-left">RA</th>
                                                                        <th className="border border-border bg-muted px-2 py-1 text-left">User</th>
                                                                        <th className="border border-border bg-muted px-2 py-1 text-left">Start → End</th>
                                                                        <th className="border border-border bg-muted px-2 py-1 text-left">
                                                                            <Tooltip>
                                                                                <TooltipTrigger asChild>
                                                                                    <span className="cursor-help border-b border-dotted">Runs / Upload</span>
                                                                                </TooltipTrigger>
                                                                                <TooltipContent>
                                                                                    <p className="max-w-xs text-xs">EEG: runs completed out of total. Transcript: NSI/Psychs upload status.</p>
                                                                                </TooltipContent>
                                                                            </Tooltip>
                                                                        </th>
                                                                        <th className="border border-border bg-muted px-2 py-1 text-left">
                                                                            <Tooltip>
                                                                                <TooltipTrigger asChild>
                                                                                    <span className="cursor-help border-b border-dotted">Status</span>
                                                                                </TooltipTrigger>
                                                                                <TooltipContent>
                                                                                    <p className="max-w-xs text-xs">REDCap completion code: 0=Incomplete, 1=Unverified, 2=Complete</p>
                                                                                </TooltipContent>
                                                                            </Tooltip>
                                                                        </th>
                                                                        <th className="border border-border bg-muted px-2 py-1 text-left">
                                                                            <Tooltip>
                                                                                <TooltipTrigger asChild>
                                                                                    <span className="cursor-help border-b border-dotted">SP Form Date</span>
                                                                                </TooltipTrigger>
                                                                                <TooltipContent>
                                                                                    <div className="max-w-xs text-xs">
                                                                                        <p className="font-semibold mb-1">SharePoint Form Submission Date</p>
                                                                                        <p>Date from <code>response.submitted.json</code> (<code>sharepoint.sharepoint_forms.form_data-&gt;&gt;&apos;event_date&apos;</code>). Should match the run sheet Session Date.</p>
                                                                                    </div>
                                                                                </TooltipContent>
                                                                            </Tooltip>
                                                                        </th>
                                                                        <th className="border border-border bg-muted px-2 py-1 text-left">
                                                                            <Tooltip>
                                                                                <TooltipTrigger asChild>
                                                                                    <span className="cursor-help border-b border-dotted">Date Check</span>
                                                                                </TooltipTrigger>
                                                                                <TooltipContent>
                                                                                    <div className="max-w-xs text-xs">
                                                                                        <p className="font-semibold mb-1">Date Discrepancy Check</p>
                                                                                        <p>Alerts if run sheet session date differs from related SharePoint file dates by &gt;1 day.</p>
                                                                                    </div>
                                                                                </TooltipContent>
                                                                            </Tooltip>
                                                                        </th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {subject.run_sheets
                                                                        .filter((rs) =>
                                                                            activeModalityTab === "all" ||
                                                                            data.run_sheet_form_to_modality[rs.form_name] === activeModalityTab
                                                                        )
                                                                        .map((rs, idx) => {
                                                                            const summary = rs.form_data_summary || {};
                                                                            const rsModality = data.run_sheet_form_to_modality[rs.form_name];
                                                                            const fileDatesForModality = subject.days
                                                                                .filter((d) => d.modality_key === rsModality)
                                                                                .map((d) => d.calendar_date);
                                                                            const hasDiscrepancy =
                                                                                rs.completion_date &&
                                                                                fileDatesForModality.length > 0 &&
                                                                                !fileDatesForModality.includes(rs.completion_date) &&
                                                                                !fileDatesForModality.some((fd) => {
                                                                                    try {
                                                                                        const fDate = new Date(fd);
                                                                                        const rDate = new Date(rs.completion_date!);
                                                                                        const diff = Math.abs(fDate.getTime() - rDate.getTime()) / (1000 * 60 * 60 * 24);
                                                                                        return diff <= 1;
                                                                                    } catch { return false; }
                                                                                });
                                                                            // SP Form date match check
                                                                            const sessionDate = summary['session_date'] || rs.completion_date || null;
                                                                            const spFormDate = summary['sp_event_date'] || null;
                                                                            const spDateMatch = sessionDate && spFormDate ? sessionDate === spFormDate : null;
                                                                            const isPerformed = summary['performed'] === '1';
                                                                            const rowBgColor = (spFormDate && spDateMatch === false) ? "bg-red-50/30 dark:bg-red-950/15"
                                                                                : hasDiscrepancy ? "bg-yellow-50/50 dark:bg-yellow-900/20"
                                                                                : isPerformed ? "bg-green-50/30 dark:bg-green-950/15"
                                                                                : "";
                                                                            const runsInfo = summary['runs'] || null;
                                                                            const uploadInfo = summary['nsi_upload'] || summary['psychs_upload']
                                                                                ? `NSI:${summary['nsi_upload'] ?? '—'} Psychs:${summary['psychs_upload'] ?? '—'}`
                                                                                : null;
                                                                            const eegExtra = summary['cap_size'] || summary['head_cir']
                                                                                ? `Cap:${summary['cap_size'] ?? '—'} Hd:${summary['head_cir'] ?? '—'}`
                                                                                : null;
                                                                            return (
                                                                                <tr key={idx} className={`hover:bg-muted/30 ${rowBgColor}`}>
                                                                                    <td className="border border-border px-2 py-1 font-mono text-[10px]">{rs.form_name}</td>
                                                                                    <td className="border border-border px-2 py-1">{rs.redcap_event_name ?? "—"}</td>
                                                                                    <td className="border border-border px-2 py-1 text-muted-foreground">{rs.form_instance_number ?? "—"}</td>
                                                                                    <td className={`border border-border px-2 py-1 whitespace-nowrap${spDateMatch === true ? ' text-green-600 dark:text-green-400 font-medium' : ''}`}>
                                                                                        {(() => { const d = summary['session_date'] || rs.completion_date; return d ? (
                                                                                            <Tooltip>
                                                                                                <TooltipTrigger asChild><span className="cursor-default">{spDateMatch === true ? '✓ ' : ''}{asReadableDate(d)}</span></TooltipTrigger>
                                                                                                <TooltipContent><p className="text-xs"><code>*_interview_date</code>: {d}</p></TooltipContent>
                                                                                            </Tooltip>
                                                                                        ) : <span className="text-muted-foreground">—</span>; })()}
                                                                                    </td>
                                                                                    <td className="border border-border px-2 py-1 whitespace-nowrap">{rs.day_offset !== null ? `${rs.day_offset >= 0 ? "+" : ""}${rs.day_offset}` : "—"}</td>
                                                                                    <td className="border border-border px-2 py-1 whitespace-nowrap">
                                                                                        {summary['performed'] !== undefined ? (
                                                                                            <span className={summary['performed'] === '1' ? 'text-green-600 dark:text-green-400 font-medium' : 'text-red-600 dark:text-red-400'}>
                                                                                                {summary['performed'] === '1' ? '✓ Yes' : '✗ No'}
                                                                                            </span>
                                                                                        ) : <span className="text-muted-foreground">—</span>}
                                                                                    </td>
                                                                                    <td className="border border-border px-2 py-1 whitespace-nowrap font-medium">{summary['technician'] || <span className="text-muted-foreground">—</span>}</td>
                                                                                    <td className="border border-border px-2 py-1 whitespace-nowrap font-mono text-[10px]">{summary['redcap_user'] || <span className="text-muted-foreground">—</span>}</td>
                                                                                    <td className="border border-border px-2 py-1 whitespace-nowrap font-mono text-[10px]">
                                                                                        {summary['start_time'] || summary['end_time'] ? (
                                                                                            <span>{summary['start_time'] ?? '—'}{summary['end_time'] ? ` → ${summary['end_time']}` : ''}</span>
                                                                                        ) : <span className="text-muted-foreground">—</span>}
                                                                                    </td>
                                                                                    <td className="border border-border px-2 py-1 whitespace-nowrap text-[10px]">
                                                                                        {runsInfo ? (
                                                                                            <Tooltip>
                                                                                                <TooltipTrigger asChild>
                                                                                                    <span className="font-medium cursor-help">{runsInfo} runs{eegExtra ? ` · ${eegExtra}` : ''}</span>
                                                                                                </TooltipTrigger>
                                                                                                <TooltipContent>EEG runs completed / total recorded. {eegExtra ?? ''}</TooltipContent>
                                                                                            </Tooltip>
                                                                                        ) : uploadInfo ? (
                                                                                            <span>{uploadInfo}</span>
                                                                                        ) : <span className="text-muted-foreground">—</span>}
                                                                                    </td>
                                                                                    <td className="border border-border px-2 py-1 whitespace-nowrap font-mono">
                                                                                        {summary['completion'] ? (
                                                                                            <span className={
                                                                                                summary['completion'] === '2' ? 'text-green-600 dark:text-green-400' :
                                                                                                summary['completion'] === '1' ? 'text-amber-600 dark:text-amber-400' :
                                                                                                'text-muted-foreground'
                                                                                            } title="REDCap completion code: 0=Incomplete, 1=Unverified, 2=Complete">
                                                                                                {summary['completion'] === '2' ? '✓ Complete' : summary['completion'] === '1' ? '~ Unverified' : '○ Incomplete'}
                                                                                            </span>
                                                                                        ) : <span className="text-muted-foreground">—</span>}
                                                                                    </td>
                                                                                    <td className="border border-border px-2 py-1 whitespace-nowrap">
                                                                                        {spFormDate ? (
                                                                                            <Tooltip>
                                                                                                <TooltipTrigger asChild>
                                                                                                    <span className={`cursor-default inline-flex items-center gap-1 ${spDateMatch === true ? 'text-green-600 dark:text-green-400' : spDateMatch === false ? 'text-red-600 dark:text-red-400' : ''}`}>
                                                                                                        {spDateMatch === true ? '✓ ' : spDateMatch === false ? '✗ ' : ''}{asReadableDate(spFormDate)}
                                                                                                    </span>
                                                                                                </TooltipTrigger>
                                                                                                <TooltipContent>
                                                                                                    <div className="max-w-xs text-xs">
                                                                                                        <p className="font-semibold">SharePoint Form Date</p>
                                                                                                        <p><code>event_date</code>: {spFormDate}</p>
                                                                                                        {sessionDate && <p>Run sheet date: {sessionDate}</p>}
                                                                                                        {spDateMatch === true && <p className="text-green-600 dark:text-green-400 mt-1">✓ Dates match</p>}
                                                                                                        {spDateMatch === false && <p className="text-red-500 mt-1">✗ Date mismatch</p>}
                                                                                                    </div>
                                                                                                </TooltipContent>
                                                                                            </Tooltip>
                                                                                        ) : <span className="text-muted-foreground">—</span>}
                                                                                    </td>
                                                                                    <td className="border border-border px-2 py-1">
                                                                                        {hasDiscrepancy ? (
                                                                                            <span className="inline-block rounded px-1.5 py-0.5 text-[10px] font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-200" title="Run sheet date differs from file pull dates">⚠ Mismatch</span>
                                                                                        ) : rs.completion_date && fileDatesForModality.length > 0 ? (
                                                                                            <span className="text-green-600 dark:text-green-400 text-[10px]">✓ Aligned</span>
                                                                                        ) : (
                                                                                            <span className="text-muted-foreground text-[10px]">—</span>
                                                                                        )}
                                                                                    </td>
                                                                                </tr>
                                                                            );
                                                                        })}
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </>
                            )}
                        </section>
                    )}
                </>
            )}

            {/* Hover tooltip */}
            {hoverTooltip && (
                <div
                    className="pointer-events-none fixed z-50 max-w-xs rounded-md border border-border bg-popover px-3 py-2 text-[11px] text-popover-foreground shadow-md"
                    style={{ left: hoverTooltip.x, top: hoverTooltip.y }}
                >
                    {hoverTooltip.lines.map((line, i) => (
                        <p key={i} className={i === 0 ? "font-semibold" : "text-muted-foreground"}>
                            {line || "\u00a0"}
                        </p>
                    ))}
                </div>
            )}
        </div>
    );
}
