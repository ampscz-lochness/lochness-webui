"use client";
import * as React from "react";
import { CalendarDays, RefreshCcw } from "lucide-react";
import { toast } from "sonner";

import { Heading } from "@/components/heading";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
        const all = data?.activity_by_subject ?? [];
        return norm ? all.filter((s) => s.subject_id.toLowerCase().includes(norm)) : all;
    }, [data, subjectFilter]);

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

    // ── Timeline data anchored at REDCap Day 1a ─────────────────────────────
    const timelineBySubject = React.useMemo(() => {
        const map = new Map<string, { day1aDate: string | null; points: TimelinePoint[] }>();
        for (const subject of filteredSubjects) {
            const day1aDate = findSubjectDay1aDate(subject.redcap_events);
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
    }, [filteredSubjects]);

    // ── Calendar timeline: day offset range ──────────────────────────────────
    const dayOffsetRange = React.useMemo(() => {
        let min = 0, max = 0;
        for (const subject of filteredSubjects) {
            const timeline = timelineBySubject.get(subject.subject_id);
            for (const d of timeline?.points ?? []) {
                if (d.day_offset_from_day1a < min) min = d.day_offset_from_day1a;
                if (d.day_offset_from_day1a > max) max = d.day_offset_from_day1a;
            }
        }
        return { min, max };
    }, [filteredSubjects, timelineBySubject]);

    const rangeSpan = Math.max(1, dayOffsetRange.max - dayOffsetRange.min);
    const toXPercent = React.useCallback(
        (offset: number) => ((offset - dayOffsetRange.min) / rangeSpan) * 100,
        [dayOffsetRange, rangeSpan]
    );
    const AXIS_TICKS = [-30, 0, 30, 60, 90, 180, 365];
    const visibleTicks = AXIS_TICKS.filter(
        (t) => t >= dayOffsetRange.min - 5 && t <= dayOffsetRange.max + 5
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
                                                const grid = buildEventGrid(subject.redcap_events, data.redcap_event_order);
                                                const latestEventName = findLatestEventName(
                                                    subject.redcap_events,
                                                    data.redcap_event_order
                                                );
                                                return (
                                                    <tr key={subject.subject_id} className="hover:bg-muted/40">
                                                        <td className="sticky left-0 z-10 border border-border bg-card px-2 py-1.5">
                                                            <span className="font-medium">{subject.subject_id}</span>
                                                            <span className="block text-[10px] text-muted-foreground">{subject.site_id}</span>
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

                                            return (
                                                <div key={subject.subject_id} className="border rounded-md p-3">
                                                    <span className="text-sm font-semibold">{subject.subject_id}</span>
                                                    <span className="ml-2 text-xs text-muted-foreground">{subject.site_id}</span>
                                                    <p className="text-xs text-muted-foreground mt-0.5 mb-2">
                                                        Day 1a (Pre-dose): {asReadableDate(timeline?.day1aDate)}
                                                    </p>

                                                    {!timeline?.day1aDate ? (
                                                        <span className="inline-flex items-center rounded-full border border-dashed border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                                                            No Day 1a (Pre-dose) event found — timeline unavailable
                                                        </span>
                                                    ) : visibleDays.length === 0 ? (
                                                        <span className="text-xs text-muted-foreground">No non-REDCap activity recorded</span>
                                                    ) : (
                                                        <div className="relative h-8 w-full">
                                                            <div className="absolute inset-0 rounded bg-muted/30" />
                                                            {dayOffsetRange.min <= 0 && dayOffsetRange.max >= 0 && (
                                                                <div
                                                                    className="absolute top-0 bottom-0 w-px bg-sky-400/70 z-10"
                                                                    style={{ left: `${toXPercent(0)}%` }}
                                                                    title="Day 1a (Pre-dose) (Day 0)"
                                                                />
                                                            )}
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
                                                                        onMouseEnter={(e) => showTooltip(e, tipLines)}
                                                                        onMouseMove={(e) => showTooltip(e, tipLines)}
                                                                        onMouseLeave={hideTooltip}
                                                                    />
                                                                );
                                                            })}
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
