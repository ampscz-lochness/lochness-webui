"use client";
import * as React from "react";
import { CalendarDays, RefreshCcw } from "lucide-react";
import { toast } from "sonner";

import { Heading } from "@/components/heading";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { DayTrackerPayload, RedcapEventRecord } from "@/types/daytracker";

// ── Modality config (mirrors monitoring/logs/page.tsx) ──────────────────────

const COVERAGE_MODALITY_COLUMNS = [
    { key: "eeg_sharepoint", label: "EEG" },
    { key: "mindlamp", label: "MindLAMP" },
    { key: "mindlamp_qc_sharepoint", label: "MindLAMP QC" },
    { key: "penncnb", label: "PennCNB" },
    { key: "cantab", label: "CANTAB" },
    { key: "transcript_sharepoint", label: "Transcript" },
] as const;

type CoverageModalityKey = (typeof COVERAGE_MODALITY_COLUMNS)[number]["key"];

const MODALITY_COLOR_BY_KEY: Record<CoverageModalityKey, string> = {
    eeg_sharepoint: "#0ea5e9",
    mindlamp: "#10b981",
    mindlamp_qc_sharepoint: "#ec4899",
    penncnb: "#6366f1",
    cantab: "#f97316",
    transcript_sharepoint: "#14b8a6",
};

// REDCap form colour palette
const FORM_COLORS = [
    "#f59e0b", "#0ea5e9", "#10b981", "#6366f1", "#f97316",
    "#ec4899", "#14b8a6", "#84cc16", "#8b5cf6", "#ef4444",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

const asReadableDate = (value: string | null | undefined): string => {
    if (!value) return "N/A";
    const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
        const [, y, m, d] = match;
        return new Date(Number(y), Number(m) - 1, Number(d)).toLocaleDateString(undefined, {
            year: "numeric", month: "short", day: "2-digit",
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

// ── REDCap event grid helpers ─────────────────────────────────────────────────

type EventCell = {
    /** Grouped records at this (subject, event) cell */
    records: RedcapEventRecord[];
    /** Distinct form names present */
    forms: string[];
    /** Whether any file_attachment record exists (field-level) */
    hasFieldLevel: boolean;
};

type TimelinePoint = {
    day_offset_from_day1a: number;
    calendar_date: string;
    modality_key: string;
    unique_file_count: number;
    file_paths: string[];
};

type HoverTooltipState = {
    x: number;
    y: number;
    lines: string[];
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

const findSubjectDay1aDate = (events: RedcapEventRecord[]): string | null => {
    const day1aEvents = events
        .filter((e) => /day_1a_predose/i.test(e.event_name))
        .map((e) => e.pull_date)
        .filter((v) => /^\d{4}-\d{2}-\d{2}$/.test(v))
        .sort();
    return day1aEvents.length > 0 ? day1aEvents[0] : null;
};

const findLatestEventName = (
    events: RedcapEventRecord[],
    eventOrder: DayTrackerPayload["redcap_event_order"]
): string | null => {
    if (events.length === 0 || eventOrder.length === 0) return null;
    const orderIndex = new Map(eventOrder.map((e, idx) => [e.event_name, idx]));
    let latestEventName: string | null = null;
    let maxIndex = -1;
    for (const ev of events) {
        const idx = orderIndex.get(ev.event_name);
        if (idx !== undefined && idx > maxIndex) {
            maxIndex = idx;
            latestEventName = ev.event_name;
        }
    }
    return latestEventName;
};

function buildEventGrid(
    events: RedcapEventRecord[],
    eventOrder: DayTrackerPayload["redcap_event_order"]
): Map<string, EventCell> {
    /** key = event_name */
    const map = new Map<string, EventCell>();
    for (const ev of eventOrder) {
        map.set(ev.event_name, { records: [], forms: [], hasFieldLevel: false });
    }
    for (const rec of events) {
        if (!map.has(rec.event_name)) {
            map.set(rec.event_name, { records: [], forms: [], hasFieldLevel: false });
        }
        const cell = map.get(rec.event_name)!;
        cell.records.push(rec);
        if (rec.form_name && !cell.forms.includes(rec.form_name)) {
            cell.forms.push(rec.form_name);
        }
        if (rec.record_type === "file_attachment") {
            cell.hasFieldLevel = true;
        }
    }
    return map;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DayTrackerPage() {
    const [projectIdInput, setProjectIdInput] = React.useState("Procan");
    const [projectId, setProjectId] = React.useState("Procan");
    const [subjectFilter, setSubjectFilter] = React.useState("");
    const [data, setData] = React.useState<DayTrackerPayload | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [activeTab, setActiveTab] = React.useState<"redcap" | "timeline">("redcap");
    const [activeModalityTab, setActiveModalityTab] = React.useState<string>("all");
    const [showLast24h, setShowLast24h] = React.useState(false);
    const [expandedSubjectId, setExpandedSubjectId] = React.useState<string | null>(null);
    const [hoverTooltip, setHoverTooltip] = React.useState<HoverTooltipState | null>(null);

    const showTooltip = React.useCallback((event: React.MouseEvent<HTMLElement>, lines: string[]) => {
        const maxX = typeof window !== "undefined" ? window.innerWidth - 340 : event.clientX + 12;
        const maxY = typeof window !== "undefined" ? window.innerHeight - 140 : event.clientY + 12;
        const x = Math.max(8, Math.min(event.clientX + 12, maxX));
        const y = Math.max(8, Math.min(event.clientY + 12, maxY));
        setHoverTooltip({ x, y, lines });
    }, []);

    const hideTooltip = React.useCallback(() => {
        setHoverTooltip(null);
    }, []);

    const fetchData = React.useCallback(async (pid: string) => {
        setLoading(true);
        try {
            const res = await fetch(`/api/v1/daytracker/${encodeURIComponent(pid)}`);
            if (!res.ok) throw new Error((await res.text()) || "Failed to fetch");
            setData(await res.json() as DayTrackerPayload);
        } catch (err) {
            console.error(err);
            setData(null);
            toast.error("Failed to load day tracker data");
        } finally {
            setLoading(false);
        }
    }, []);

    React.useEffect(() => { fetchData(projectId); }, [projectId, fetchData]);

    // ── Per-form colour map ───────────────────────────────────────────────────
    const formColorMap = React.useMemo(() => {
        const map = new Map<string, string>();
        (data?.redcap_forms ?? []).forEach((form, i) => {
            map.set(form, FORM_COLORS[i % FORM_COLORS.length]);
        });
        return map;
    }, [data]);

    // ── Filtered subjects ─────────────────────────────────────────────────────
    const filteredSubjects = React.useMemo(() => {
        const norm = subjectFilter.trim().toLowerCase();
        // Only show subjects with a confirmed consent date
        let all = (data?.activity_by_subject ?? []).filter((s) => s.is_consented);
        if (norm) {
            all = all.filter((s) => s.subject_id.toLowerCase().includes(norm));
        }
        if (showLast24h) {
            const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split("T")[0];
            all = all
                .map((s) => ({
                    ...s,
                    redcap_events: s.redcap_events.filter((e) => e.pull_date >= cutoff),
                    days: s.days.filter((d) => d.calendar_date >= cutoff),
                }))
                .filter((s) => s.redcap_events.length > 0 || s.days.length > 0);
        }
        return all;
    }, [data, subjectFilter, showLast24h]);

    // ── Modality tabs (for calendar timeline) ─────────────────────────────────
    const modalityTabOptions = React.useMemo(() => {
        const available = new Set<CoverageModalityKey>();
        for (const s of data?.activity_by_subject ?? []) {
            for (const d of s.days) {
                if (COVERAGE_MODALITY_COLUMNS.some((c) => c.key === d.modality_key)) {
                    available.add(d.modality_key as CoverageModalityKey);
                }
            }
        }
        return [
            { key: "all", label: "All" },
            ...COVERAGE_MODALITY_COLUMNS.filter((c) => available.has(c.key)).map((c) => ({ key: c.key, label: c.label })),
        ];
    }, [data]);

    React.useEffect(() => {
        if (!modalityTabOptions.some((t) => t.key === activeModalityTab)) setActiveModalityTab("all");
    }, [activeModalityTab, modalityTabOptions]);

    // ── Lookup map for original (unfiltered) subjects ──────────────────────
    const originalSubjectMap = React.useMemo(() => {
        const map = new Map<string, DayTrackerPayload["activity_by_subject"][number]>();
        for (const s of data?.activity_by_subject ?? []) map.set(s.subject_id, s);
        return map;
    }, [data]);

    // ── Timeline data anchored at REDCap Day 1a ─────────────────────────────
    const timelineBySubject = React.useMemo(() => {
        const map = new Map<string, { day1aDate: string | null; points: TimelinePoint[] }>();
        for (const subject of filteredSubjects) {
            // Always use the unfiltered events for the Day 1a anchor so the
            // 24 h toggle doesn't erase a Day 1a event pulled weeks ago.
            const originalEvents = originalSubjectMap.get(subject.subject_id)?.redcap_events ?? subject.redcap_events;
            const day1aDate = findSubjectDay1aDate(originalEvents);
            const points: TimelinePoint[] = [];
            for (const day of subject.days) {
                if (!day1aDate) continue;
                const adjusted = diffDays(day.calendar_date, day1aDate);
                if (adjusted === null) continue;
                points.push({
                    day_offset_from_day1a: adjusted,
                    calendar_date: day.calendar_date,
                    modality_key: day.modality_key,
                    unique_file_count: day.unique_file_count,
                    file_paths: day.file_paths,
                });
            }
            map.set(subject.subject_id, { day1aDate, points });
        }
        return map;
    }, [filteredSubjects, originalSubjectMap]);

    // ── Calendar timeline: day offset range ──────────────────────────────────
    const dayOffsetRange = React.useMemo(() => {
        let min = 0, max = 0;
        for (const subject of filteredSubjects) {
            const timeline = timelineBySubject.get(subject.subject_id);
            for (const d of timeline?.points ?? []) {
                if (d.day_offset_from_day1a < min) min = d.day_offset_from_day1a;
                if (d.day_offset_from_day1a > max) max = d.day_offset_from_day1a;
            }
            // Also include consent date offset so it's never clipped off-screen
            const originalSubject = originalSubjectMap.get(subject.subject_id);
            if (timeline?.day1aDate && originalSubject?.consent_date) {
                const consentOffset = diffDays(originalSubject.consent_date, timeline.day1aDate);
                if (consentOffset !== null) {
                    if (consentOffset < min) min = consentOffset;
                    if (consentOffset > max) max = consentOffset;
                }
            }
        }
        return { min, max };
    }, [filteredSubjects, timelineBySubject, originalSubjectMap]);

    // Add padding so lines near the edges stay visible
    const RANGE_PADDING = 5;
    const paddedMin = dayOffsetRange.min - RANGE_PADDING;
    const paddedMax = dayOffsetRange.max + RANGE_PADDING;
    const rangeSpan = Math.max(1, paddedMax - paddedMin);
    const toXPercent = React.useCallback(
        (offset: number) => ((offset - paddedMin) / rangeSpan) * 100,
        [paddedMin, rangeSpan]
    );
    const AXIS_TICKS = [-30, 0, 30, 60, 90, 180, 365];
    const visibleTicks = AXIS_TICKS.filter(
        (t) => t >= paddedMin && t <= paddedMax
    );

    const maxBucketTotal = React.useMemo(() => {
        let max = 1;
        for (const subject of filteredSubjects) {
            const timeline = timelineBySubject.get(subject.subject_id);
            for (const d of timeline?.points ?? []) {
                const total = (activeModalityTab === "all" || d.modality_key === activeModalityTab)
                    ? d.unique_file_count : 0;
                if (total > max) max = total;
            }
        }
        return max;
    }, [filteredSubjects, activeModalityTab, timelineBySubject]);

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div className="container mx-auto flex max-w-6xl flex-col gap-6 p-6">
            <Heading icon={<CalendarDays className="h-8 w-8" />} title="Day Tracker" />
            <p className="text-sm text-muted-foreground -mt-4">
                REDCap study-event activity and non-REDCap data timeline per participant
            </p>

            {/* Controls */}
            <div className="border rounded-lg p-4 bg-card text-card-foreground">
                <div className="flex flex-col md:flex-row md:items-end gap-3">
                    <div className="flex-1">
                        <label htmlFor="dt-project-id" className="text-sm font-medium block mb-1">Project ID</label>
                        <Input
                            id="dt-project-id"
                            value={projectIdInput}
                            onChange={(e) => setProjectIdInput(e.target.value)}
                            placeholder="Enter project ID"
                            onKeyDown={(e) => { if (e.key === "Enter" && projectIdInput.trim()) setProjectId(projectIdInput.trim()); }}
                        />
                    </div>
                    <div className="flex-1">
                        <label htmlFor="dt-subject-filter" className="text-sm font-medium block mb-1">Filter by Subject ID</label>
                        <Input
                            id="dt-subject-filter"
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
                        id="dt-last24h"
                        checked={showLast24h}
                        onCheckedChange={setShowLast24h}
                    />
                    <label htmlFor="dt-last24h" className="text-sm font-medium cursor-pointer select-none">
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
                    Loading day tracker…
                </div>
            ) : !data ? (
                <div className="border rounded-lg p-6 bg-card text-card-foreground text-sm text-muted-foreground">
                    Day tracker data is unavailable.
                </div>
            ) : (
                <>
                    {/* View selector */}
                    <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "redcap" | "timeline")} className="w-full">
                        <TabsList>
                            <TabsTrigger value="redcap">REDCap Study Events</TabsTrigger>
                            <TabsTrigger value="timeline">Other Modalities Timeline</TabsTrigger>
                        </TabsList>
                    </Tabs>

                    <p className="text-sm text-muted-foreground -mt-3">
                        Showing {filteredSubjects.length} of {data.activity_by_subject.length} participant{data.activity_by_subject.length === 1 ? "" : "s"}
                    </p>

                    {/* ── REDCap Study Events tab ──────────────────────────── */}
                    {activeTab === "redcap" && (
                        <section className="border rounded-lg p-4 bg-card text-card-foreground">
                            <div className="mb-3">
                                <h2 className="text-base font-semibold">REDCap Study Events</h2>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    X-axis = protocol visit (from <code>pull_metadata.event_name</code>).
                                    Cells show which CRF instruments had file attachments pulled at each visit.
                                    Colour = instrument (form). Tooltip = field name.
                                </p>
                            </div>

                            {/* Form colour legend */}
                            {data.redcap_forms.length > 0 && (
                                <div className="mb-4 flex flex-wrap gap-x-4 gap-y-2 text-[11px] text-muted-foreground">
                                    {data.redcap_forms.map((form) => (
                                        <span key={form} className="inline-flex items-center gap-1.5">
                                            <span
                                                className="h-2.5 w-2.5 rounded-sm border border-black/10 shrink-0"
                                                style={{ backgroundColor: formColorMap.get(form) ?? "#aaa" }}
                                                aria-hidden="true"
                                            />
                                            <span>{form}</span>
                                        </span>
                                    ))}
                                </div>
                            )}

                            {data.redcap_event_order.length === 0 ? (
                                <p className="text-sm text-muted-foreground">
                                    No REDCap event data found. Pulls may not yet contain event_name in pull_metadata.
                                </p>
                            ) : filteredSubjects.length === 0 ? (
                                <p className="text-sm text-muted-foreground">No participants match the current filter.</p>
                            ) : (
                                <div className="overflow-x-auto">
                                    <table className="w-full border-collapse text-[11px]">
                                        <thead>
                                            <tr>
                                                <th className="sticky left-0 z-10 min-w-[160px] border border-border bg-muted px-2 py-1.5 text-left font-semibold text-xs">
                                                    Participant
                                                </th>
                                                {data.redcap_event_order.map((ev) => (
                                                    <th
                                                        key={ev.event_name}
                                                        className="min-w-[110px] border border-border bg-muted px-2 py-1.5 text-center font-semibold"
                                                        title={ev.event_name}
                                                    >
                                                        {ev.event_label}
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filteredSubjects.map((subject) => {
                                                if (showLast24h && subject.redcap_events.length === 0) return null;
                                                const grid = buildEventGrid(subject.redcap_events, data.redcap_event_order);
                                                const latestEventName = findLatestEventName(
                                                    subject.redcap_events,
                                                    data.redcap_event_order
                                                );
                                                const isExpanded = expandedSubjectId === subject.subject_id;
                                                const colSpan = data.redcap_event_order.length + 1;
                                                return (
                                                    <React.Fragment key={subject.subject_id}>
                                                    <tr
                                                        className={`cursor-pointer hover:bg-muted/40 ${isExpanded ? "bg-muted/30" : ""}`}
                                                        onClick={() => setExpandedSubjectId(isExpanded ? null : subject.subject_id)}
                                                    >
                                                        <td className="sticky left-0 z-10 border border-border bg-card px-2 py-1.5">
                                                            <span className="inline-flex items-center gap-1.5">
                                                                <span className="font-medium">{subject.subject_id}</span>
                                                                {subject.is_consented ? (
                                                                    <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-green-500 text-[9px] font-bold text-white dark:bg-green-600" title={`Consented — consent date: ${asReadableDate(subject.consent_date)}`}>
                                                                        ✓
                                                                    </span>
                                                                ) : (
                                                                    <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-[9px] font-bold text-white dark:bg-amber-500" title="No consent date recorded — may be withdrawn or unenrolled">
                                                                        !
                                                                    </span>
                                                                )}
                                                                {!originalSubjectMap.get(subject.subject_id)?.redcap_events.some(e => /day_1a_predose/i.test(e.event_name)) && (
                                                                    <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-orange-500 text-[9px] font-bold text-white dark:bg-orange-600" title="No Day 1a (Pre-dose) event in REDCap — subject may not have started the treatment phase">
                                                                        –
                                                                    </span>
                                                                )}
                                                            </span>
                                                            <span className="block text-[9px] text-muted-foreground/50 select-none">{isExpanded ? "▲ collapse" : "▼ expand"}</span>
                                                        </td>
                                                        {data.redcap_event_order.map((ev) => {
                                                            const cell = grid.get(ev.event_name);
                                                            const isLatestCell = latestEventName === ev.event_name;
                                                            if (!cell || cell.records.length === 0) {
                                                                return (
                                                                    <td
                                                                        key={ev.event_name}
                                                                        className={`border border-border px-1 py-1 text-center ${isLatestCell ? "bg-amber-50/70 ring-1 ring-inset ring-amber-300" : ""}`}
                                                                    >
                                                                        <span className="text-border">—</span>
                                                                    </td>
                                                                );
                                                            }

                                                            // Build tooltip
                                                            const tooltipLines: string[] = [
                                                                `${ev.event_label}  (${subject.subject_id})`,
                                                                `${cell.records.length} pull record${cell.records.length === 1 ? "" : "s"}`,
                                                            ];
                                                            const pullDates = cell.records
                                                                .map((r) => r.pull_date)
                                                                .filter((v, i, a) => v && a.indexOf(v) === i)
                                                                .sort();
                                                            if (pullDates.length > 0) {
                                                                tooltipLines.push(
                                                                    pullDates.length === 1
                                                                        ? `Pull date: ${asReadableDate(pullDates[0])}`
                                                                        : `Pull dates: ${pullDates.map(asReadableDate).join(", ")}`
                                                                );
                                                            }
                                                            if (cell.forms.length > 0) {
                                                                tooltipLines.push("", "Forms:");
                                                                for (const form of cell.forms) {
                                                                    const fields = cell.records
                                                                        .filter((r) => r.form_name === form && r.field_name)
                                                                        .map((r) => r.field_name!)
                                                                        .filter((v, i, a) => a.indexOf(v) === i);
                                                                    tooltipLines.push(
                                                                        fields.length > 0
                                                                            ? `  ${form}: ${fields.join(", ")}`
                                                                            : `  ${form}`
                                                                    );
                                                                }
                                                            }

                                                            return (
                                                                <td
                                                                    key={ev.event_name}
                                                                    className={`border border-border px-1 py-1 ${isLatestCell ? "bg-amber-50/70 ring-1 ring-inset ring-amber-300" : ""}`}
                                                                    title={tooltipLines.join("\n")}
                                                                    onMouseEnter={(e) => showTooltip(e, tooltipLines)}
                                                                    onMouseMove={(e) => showTooltip(e, tooltipLines)}
                                                                    onMouseLeave={hideTooltip}
                                                                >
                                                                    <div className="flex flex-wrap gap-0.5 justify-center items-center">
                                                                        {isLatestCell && (
                                                                            <span className="inline-block rounded border border-amber-300 bg-amber-200 px-1 py-0.5 text-[9px] font-semibold leading-none text-amber-900">
                                                                                Latest
                                                                            </span>
                                                                        )}
                                                                        {cell.forms.length > 0 ? (
                                                                            cell.forms.map((form) => {
                                                                                const fieldRecs = cell.records.filter(
                                                                                    (r) => r.form_name === form && r.field_name
                                                                                );
                                                                                return (
                                                                                    <span
                                                                                        key={form}
                                                                                        className="inline-block rounded px-1 py-0.5 text-white leading-none font-medium"
                                                                                        style={{ backgroundColor: formColorMap.get(form) ?? "#aaa" }}
                                                                                    >
                                                                                        {fieldRecs.length > 0 ? fieldRecs.length : "✓"}
                                                                                    </span>
                                                                                );
                                                                            })
                                                                        ) : (
                                                                            <span className="inline-flex items-center rounded-full bg-muted/60 px-1.5 py-0.5 text-muted-foreground">
                                                                                {cell.records.length}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                </td>
                                                            );
                                                        })}
                                                    </tr>
                                                    {isExpanded && (
                                                        <tr>
                                                            <td colSpan={colSpan} className="border border-border bg-muted/20 p-3">
                                                                <p className="text-xs font-semibold mb-2">
                                                                    {subject.subject_id} — all pull records
                                                                    {subject.consent_date && <span className="ml-2 font-normal text-muted-foreground">Consent: {asReadableDate(subject.consent_date)}</span>}
                                                                </p>
                                                                <div className="overflow-x-auto">
                                                                    <table className="w-full border-collapse text-[11px]">
                                                                        <thead>
                                                                            <tr>
                                                                                <th className="border border-border bg-muted px-2 py-1 text-left">Pull Date</th>
                                                                                <th className="border border-border bg-muted px-2 py-1 text-left">Event</th>
                                                                                <th className="border border-border bg-muted px-2 py-1 text-left">Type</th>
                                                                                <th className="border border-border bg-muted px-2 py-1 text-left">Form</th>
                                                                                <th className="border border-border bg-muted px-2 py-1 text-left">Field</th>
                                                                                <th className="border border-border bg-muted px-2 py-1 text-left">File</th>
                                                                            </tr>
                                                                        </thead>
                                                                        <tbody>
                                                                            {[...subject.redcap_events]
                                                                                .sort((a, b) => a.pull_date.localeCompare(b.pull_date))
                                                                                .map((rec, idx) => (
                                                                                    <tr key={idx} className="hover:bg-muted/30">
                                                                                        <td className="border border-border px-2 py-1 whitespace-nowrap">{asReadableDate(rec.pull_date)}</td>
                                                                                        <td className="border border-border px-2 py-1 whitespace-nowrap">
                                                                                            <span className="inline-block rounded px-1.5 py-0.5 text-white text-[10px] font-medium" style={{ backgroundColor: formColorMap.get(rec.form_name ?? "") ?? "#6366f1" }}>
                                                                                                {rec.event_label}
                                                                                            </span>
                                                                                        </td>
                                                                                        <td className="border border-border px-2 py-1 text-muted-foreground">{rec.record_type}</td>
                                                                                        <td className="border border-border px-2 py-1">{rec.form_name ?? "—"}</td>
                                                                                        <td className="border border-border px-2 py-1 font-mono text-[10px]">{rec.field_name ?? "—"}</td>
                                                                                        <td className="border border-border px-2 py-1 max-w-[220px] truncate" title={rec.file_path ?? undefined}>{rec.file_path ? asFileName(rec.file_path) : "—"}</td>
                                                                                    </tr>
                                                                                ))
                                                                            }
                                                                        </tbody>
                                                                    </table>
                                                                </div>
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

                            {/* Field-level detail: expandable per-subject list */}
                            {filteredSubjects.some((s) => s.redcap_events.some((e) => e.record_type === "file_attachment")) && (
                                <details className="mt-4">
                                    <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">
                                        Field-level detail (file attachments only)
                                    </summary>
                                    <div className="mt-3 space-y-3">
                                        {filteredSubjects.map((subject) => {
                                            const attachments = subject.redcap_events.filter(
                                                (e) => e.record_type === "file_attachment"
                                            );
                                            if (attachments.length === 0) return null;
                                            return (
                                                <div key={subject.subject_id} className="border rounded-md p-3">
                                                    <p className="text-sm font-semibold mb-2">{subject.subject_id}</p>
                                                    <div className="overflow-x-auto">
                                                        <table className="w-full border-collapse text-[11px]">
                                                            <thead>
                                                                <tr>
                                                                    <th className="border border-border bg-muted px-2 py-1 text-left">Pull Date</th>
                                                                    <th className="border border-border bg-muted px-2 py-1 text-left">Event</th>
                                                                    <th className="border border-border bg-muted px-2 py-1 text-left">Form</th>
                                                                    <th className="border border-border bg-muted px-2 py-1 text-left">Field</th>
                                                                    <th className="border border-border bg-muted px-2 py-1 text-left">File</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {attachments.map((rec, idx) => (
                                                                    <tr key={idx} className="hover:bg-muted/30">
                                                                        <td className="border border-border px-2 py-1 whitespace-nowrap">{asReadableDate(rec.pull_date)}</td>
                                                                        <td className="border border-border px-2 py-1 whitespace-nowrap">
                                                                            <span
                                                                                className="inline-block rounded px-1.5 py-0.5 text-white text-[10px] font-medium"
                                                                                style={{ backgroundColor: formColorMap.get(rec.form_name ?? "") ?? "#6366f1" }}
                                                                            >
                                                                                {rec.event_label}
                                                                            </span>
                                                                        </td>
                                                                        <td className="border border-border px-2 py-1">{rec.form_name ?? "—"}</td>
                                                                        <td className="border border-border px-2 py-1 font-mono text-[10px]">{rec.field_name ?? "—"}</td>
                                                                        <td className="border border-border px-2 py-1 max-w-[200px] truncate" title={rec.file_path ?? undefined}>
                                                                            {rec.file_path ? asFileName(rec.file_path) : "—"}
                                                                        </td>
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </details>
                            )}
                        </section>
                    )}

                    {/* ── Other Modalities Timeline tab ─────────────────────── */}
                    {activeTab === "timeline" && (
                        <section className="border rounded-lg p-4 bg-card text-card-foreground">
                            <div className="mb-3">
                                <h2 className="text-base font-semibold">Other Modalities — Days from REDCap Day 1a (Pre-dose)</h2>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    X-axis = calendar days relative to REDCap Day 1a (Pre-dose) (Day 0 = Day 1a).
                                    REDCap is excluded here; use the REDCap Study Events tab for REDCap data.
                                </p>
                            </div>

                            {/* Modality tabs */}
                            <Tabs value={activeModalityTab} onValueChange={setActiveModalityTab} className="w-full mb-4">
                                <TabsList className="flex h-auto flex-wrap justify-start gap-2">
                                    {modalityTabOptions.map((tab) => (
                                        <TabsTrigger key={tab.key} value={tab.key}>
                                            <span className="inline-flex items-center gap-2">
                                                {tab.key !== "all" && (
                                                    <span
                                                        className="h-2 w-2 rounded-full border border-black/10"
                                                        style={{ backgroundColor: MODALITY_COLOR_BY_KEY[tab.key as CoverageModalityKey] }}
                                                        aria-hidden="true"
                                                    />
                                                )}
                                                <span>{tab.label}</span>
                                            </span>
                                        </TabsTrigger>
                                    ))}
                                </TabsList>
                            </Tabs>

                            {filteredSubjects.length === 0 ? (
                                <p className="text-sm text-muted-foreground">No participants match the current filter.</p>
                            ) : (
                                <>
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
                                                        <span className="text-sm font-semibold">{subject.subject_id}</span>
                                                        <span className="text-xs text-muted-foreground">{subject.site_id}</span>
                                                        {subject.is_consented ? (
                                                            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-green-500 text-[9px] font-bold text-white dark:bg-green-600" title={`Consented — consent date: ${asReadableDate(subject.consent_date)}`}>
                                                                ✓
                                                            </span>
                                                        ) : (
                                                            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-[9px] font-bold text-white dark:bg-amber-500" title="No consent date recorded — may be withdrawn or unenrolled">
                                                                !
                                                            </span>
                                                        )}
                                                        {!timeline?.day1aDate && (
                                                            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-orange-500 text-[9px] font-bold text-white dark:bg-orange-600" title="No Day 1a (Pre-dose) event in REDCap — subject may not have started the treatment phase">
                                                                –
                                                            </span>
                                                        )}
                                                        <span className="ml-auto text-[9px] text-muted-foreground/50 select-none">{isExpanded ? "▲ collapse" : "▼ expand"}</span>
                                                    </div>
                                                    <p className="text-xs text-muted-foreground mt-0.5 mb-2">
                                                        Day 1a (Pre-dose): {asReadableDate(timeline?.day1aDate)}
                                                    </p>

                                                    {!timeline?.day1aDate ? (
                                                        <span className="inline-flex items-center rounded-full border border-dashed border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                                                            No Day 1a (Pre-dose) event found — timeline unavailable
                                                        </span>
                                                    ) : visibleDays.length === 0 ? (
                                                        <span className="text-xs text-muted-foreground">{showLast24h ? "No data in the last 24 hours" : "No non-REDCap activity recorded"}</span>
                                                    ) : (
                                                        <div className={`relative w-full ${isExpanded ? "h-20" : "h-8"}`}>
                                                            <div className="absolute inset-0 rounded bg-muted/30" />
                                                            {/* Vertical reference lines: Day 1a (red dashed) and consent date (green dashed) */}
                                                            {(() => {
                                                                const consentDate = originalSubjectMap.get(subject.subject_id)?.consent_date ?? subject.consent_date;
                                                                const consentOffset = (timeline?.day1aDate && consentDate)
                                                                    ? diffDays(consentDate, timeline.day1aDate) : null;
                                                                const xDay1a = toXPercent(0);
                                                                const xConsent = consentOffset !== null ? toXPercent(consentOffset) : null;
                                                                // Detect overlap: within 2% of range
                                                                const overlapping = xConsent !== null && Math.abs(xConsent - xDay1a) < 2;
                                                                const day1aLines = [(
                                                                    <div
                                                                        key="day1a"
                                                                        className="absolute top-0 bottom-0 z-10 cursor-default"
                                                                        style={{
                                                                            left: `${xDay1a + (overlapping ? 1.5 : 0)}%`,
                                                                            width: "1px",
                                                                            background: "repeating-linear-gradient(to bottom, rgba(239,68,68,0.7) 0px, rgba(239,68,68,0.7) 4px, transparent 4px, transparent 8px)",
                                                                        }}
                                                                        onMouseEnter={(e) => showTooltip(e, ["Day 1a (Pre-dose)", "Day 0 anchor"])}
                                                                        onMouseMove={(e) => showTooltip(e, ["Day 1a (Pre-dose)", "Day 0 anchor"])}
                                                                        onMouseLeave={hideTooltip}
                                                                    />
                                                                )];
                                                                const consentLine = (xConsent !== null && consentDate) ? (
                                                                    <div
                                                                        key="consent"
                                                                        className="absolute top-0 bottom-0 z-20 cursor-default"
                                                                        style={{
                                                                            left: `${xConsent - (overlapping ? 1.5 : 0)}%`,
                                                                            width: "1px",
                                                                            background: "repeating-linear-gradient(to bottom, rgba(34,197,94,0.75) 0px, rgba(34,197,94,0.75) 4px, transparent 4px, transparent 8px)",
                                                                        }}
                                                                        onMouseEnter={(e) => showTooltip(e, [
                                                                            `Consent date: ${asReadableDate(consentDate)}`,
                                                                            `Day ${consentOffset! >= 0 ? "+" : ""}${consentOffset} from Day 1a`,
                                                                        ])}
                                                                        onMouseMove={(e) => showTooltip(e, [
                                                                            `Consent date: ${asReadableDate(consentDate)}`,
                                                                            `Day ${consentOffset! >= 0 ? "+" : ""}${consentOffset} from Day 1a`,
                                                                        ])}
                                                                        onMouseLeave={hideTooltip}
                                                                    />
                                                                ) : null;
                                                                return <>{day1aLines}{consentLine}</>;
                                                            })()}
                                                            {visibleDays.map((day) => {
                                                                const xLeft = toXPercent(day.day_offset_from_day1a);
                                                                const barW = Math.max(0.5, (1 / rangeSpan) * 100);
                                                                const hPct = Math.max(20, (day.unique_file_count / maxBucketTotal) * 100);
                                                                const color = MODALITY_COLOR_BY_KEY[day.modality_key as CoverageModalityKey] ?? "#10b981";
                                                                const tipLines = [
                                                                    `Day ${day.day_offset_from_day1a >= 0 ? "+" : ""}${day.day_offset_from_day1a} (${asReadableDate(day.calendar_date)})`,
                                                                    `${day.modality_key}: ${day.unique_file_count} file${day.unique_file_count === 1 ? "" : "s"}`,
                                                                    ...(day.file_paths.length > 0 ? ["", ...day.file_paths.slice(0, 3).map(asFileName)] : []),
                                                                ];
                                                                const tip = tipLines.join("\n");
                                                                return (
                                                                    <div
                                                                        key={`${day.modality_key}-${day.day_offset_from_day1a}`}
                                                                        className="absolute bottom-0 overflow-hidden rounded-sm"
                                                                        style={{ left: `${xLeft}%`, width: `${barW}%`, height: `${hPct}%`, minWidth: "3px", backgroundColor: color }}
                                                                        title={tip}
                                                                        onMouseEnter={(e) => { e.stopPropagation(); showTooltip(e, tipLines); }}
                                                                        onMouseMove={(e) => { e.stopPropagation(); showTooltip(e, tipLines); }}
                                                                        onMouseLeave={hideTooltip}
                                                                        onClick={(e) => e.stopPropagation()}
                                                                    />
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                    {/* Expanded detail: sorted file listing */}
                                                    {isExpanded && visibleDays.length > 0 && (
                                                        <div className="mt-3 overflow-x-auto" onClick={(e) => e.stopPropagation()}>
                                                            <table className="w-full border-collapse text-[11px]">
                                                                <thead>
                                                                    <tr>
                                                                        <th className="border border-border bg-muted px-2 py-1 text-left">Date</th>
                                                                        <th className="border border-border bg-muted px-2 py-1 text-left">Day from 1a</th>
                                                                        <th className="border border-border bg-muted px-2 py-1 text-left">Modality</th>
                                                                        <th className="border border-border bg-muted px-2 py-1 text-left">Files</th>
                                                                        <th className="border border-border bg-muted px-2 py-1 text-left">Sample file</th>
                                                                    </tr>
                                                                </thead>
                                                                <tbody>
                                                                    {[...visibleDays]
                                                                        .sort((a, b) => a.day_offset_from_day1a - b.day_offset_from_day1a)
                                                                        .map((day, idx) => (
                                                                            <tr key={idx} className="hover:bg-muted/30">
                                                                                <td className="border border-border px-2 py-1 whitespace-nowrap">{asReadableDate(day.calendar_date)}</td>
                                                                                <td className="border border-border px-2 py-1 whitespace-nowrap">{day.day_offset_from_day1a >= 0 ? "+" : ""}{day.day_offset_from_day1a}</td>
                                                                                <td className="border border-border px-2 py-1">
                                                                                    <span className="inline-flex items-center gap-1">
                                                                                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: MODALITY_COLOR_BY_KEY[day.modality_key as CoverageModalityKey] ?? "#aaa" }} />
                                                                                        {day.modality_key}
                                                                                    </span>
                                                                                </td>
                                                                                <td className="border border-border px-2 py-1">{day.unique_file_count}</td>
                                                                                <td className="border border-border px-2 py-1 max-w-[220px] truncate text-muted-foreground" title={day.file_paths[0]}>{day.file_paths[0] ? asFileName(day.file_paths[0]) : "—"}</td>
                                                                            </tr>
                                                                        ))
                                                                    }
                                                                </tbody>
                                                            </table>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {/* Shared X axis */}
                                    <div className="mt-4">
                                        <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                                            Days from REDCap Day 1a (Pre-dose) (0 = Day 1a)
                                        </p>
                                        <div className="relative h-8 border-t border-dashed border-border/70">
                                            {visibleTicks.map((tick) => {
                                                const lp = toXPercent(tick);
                                                if (lp < 0 || lp > 100) return null;
                                                return (
                                                    <div key={tick} className="absolute top-0" style={{ left: `${lp}%` }}>
                                                        <div className="h-2 w-px -translate-x-1/2 bg-border/80" />
                                                        <span className="absolute top-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] text-muted-foreground">
                                                            {tick === 0 ? "0" : tick > 0 ? `+${tick}` : tick}
                                                        </span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {/* Modality legend */}
                                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                                        {COVERAGE_MODALITY_COLUMNS.map((col) => (
                                            <span key={col.key} className="inline-flex items-center gap-1.5">
                                                <span
                                                    className="h-2.5 w-2.5 rounded-sm border border-black/10 shrink-0"
                                                    style={{ backgroundColor: MODALITY_COLOR_BY_KEY[col.key] }}
                                                    aria-hidden="true"
                                                />
                                                {col.label}
                                            </span>
                                        ))}
                                    </div>
                                </>
                            )}
                        </section>
                    )}
                </>
            )}

            {hoverTooltip && (
                <div
                    className="pointer-events-none fixed z-50 max-w-[320px] rounded-md border border-border bg-background/95 px-2.5 py-2 text-[11px] shadow-lg"
                    style={{ left: `${hoverTooltip.x}px`, top: `${hoverTooltip.y}px` }}
                >
                    {hoverTooltip.lines.map((line, idx) => (
                        line.trim() === "" ? (
                            <div key={idx} className="h-1" />
                        ) : (
                            <div key={idx} className="leading-snug text-foreground/90">{line}</div>
                        )
                    ))}
                </div>
            )}
        </div>
    );
}
