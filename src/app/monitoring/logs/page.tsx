"use client"
import * as React from "react";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { ThemeProvider as MuiThemeProvider, createTheme } from "@mui/material/styles";
import { useTheme } from "next-themes";

import { BarChart3, FileDown, RefreshCcw, Terminal } from "lucide-react";
import { toast } from "sonner";

import { Heading } from "@/components/heading";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type MonitoringResponse = {
    project_id: string;
    summary: {
        subjects_missing_required_variables_count: number;
        subjects_missing_required_variables_by_site: Array<{
            site_id: string;
            count: number;
            subject_ids: string[];
            mindlamp_ids: string[];
            cantab_ids: string[];
        }>;
        newly_added_last_night_count: number;
    };
    subjects_with_consent_date: Array<{
        subject_id: string;
        site_id: string;
        consent_date: string | null;
        mindlamp_id: string | null;
        cantab_id: string | null;
    }>;
    newly_added_last_night: Array<{ subject_id: string; site_id: string; created_at: string | null }>;
    consent_dates_by_subject: Array<{ subject_id: string; consent_date: string | null }>;
    unique_file_paths_by_data_source: Array<{ subject_id: string; data_source_name: string | null; unique_file_paths: number }>;
    data_pull_coverage_by_subject: Array<{
        subject_id: string;
        total_pulls: number;
        pulls_with_unique_file_md5: number;
        recent_pull_items: Array<{
            subject_id: string;
            data_source_name: string | null;
            pull_timestamp: string | null;
            file_md5: string | null;
            file_path: string | null;
            has_file_md5: boolean;
        }>;
    }>;
    data_pull_trend_by_subject: Array<{ subject_id: string; day: string; pulls_with_unique_file_md5: number; is_consent_date: boolean; file_paths: string[] }>;
    data_pull_trend_by_subject_and_modality: Array<{
        subject_id: string;
        modality_key: string | null;
        day: string;
        pulls_with_unique_file_md5: number;
        is_consent_date: boolean;
        file_paths: string[];
    }>;
    data_pull_activity_last_48h: Array<{
        hour_start: string;
        modality_key: string | null;
        pull_count: number;
    }>;
    last_warning_logs: Array<{
        timestamp: string;
        level: string;
        message: string;
        site_id: string | null;
        subject_id: string | null;
        data_source_name: string | null;
    }>;
    metadata?: {
        notes?: {
            data_pulls_available?: boolean;
            files_available?: boolean;
        };
    };
};

const asLocalDateTime = (value: string | null | undefined): string => {
    if (!value) return "N/A";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "N/A";
    return date.toLocaleString();
};

const asReadableDate = (value: string | null | undefined): string => {
    if (!value) return "N/A";
    const dateOnlyMatch = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnlyMatch) {
        const year = Number(dateOnlyMatch[1]);
        const month = Number(dateOnlyMatch[2]);
        const day = Number(dateOnlyMatch[3]);
        const localDate = new Date(year, month - 1, day);
        return localDate.toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "2-digit",
        });
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "N/A";
    return date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "2-digit",
    });
};

const asFileName = (value: string | null | undefined): string => {
    if (!value) return "N/A";
    const normalized = value.replace(/\\/g, "/");
    const parts = normalized.split("/").filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : value;
};

const asDateKey = (value: string | null | undefined): string | null => {
    if (!value) return null;
    const trimmed = value.trim();
    const match = trimmed.match(/^\d{4}-\d{2}-\d{2}/);
    if (match) return match[0];

    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString().slice(0, 10);
};

const asHourKey = (value: string | null | undefined): string | null => {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    parsed.setMinutes(0, 0, 0);
    return parsed.toISOString();
};

const asReadableHour = (value: string | null | undefined): string => {
    if (!value) return "N/A";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "N/A";
    return parsed.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
    });
};

const normalizeDataSourceName = (value: string | null | undefined): string => {
    if (!value) return "unknown";
    const firstUnderscore = value.indexOf("_");
    if (firstUnderscore === -1) return value;
    return value.slice(firstUnderscore + 1);
};

const COVERAGE_MODALITY_COLUMNS = [
    { key: "redcap", label: "REDCap" },
    { key: "eeg_sharepoint", label: "EEG (SharePoint)" },
    { key: "mindlamp", label: "MindLAMP" },
    { key: "mindlamp_qc_sharepoint", label: "MindLAMP QC (SharePoint)" },
    { key: "penncnb", label: "PennCNB (UPENN_recap)" },
    { key: "cantab", label: "CANTAB" },
    { key: "transcript_sharepoint", label: "Transcript (SharePoint)" },
] as const;

type CoverageModalityKey = (typeof COVERAGE_MODALITY_COLUMNS)[number]["key"];

type TrendSegment = {
    key: string;
    label: string;
    count: number;
    color: string;
};

type TrendPoint = {
    day: string;
    pulls_with_unique_file_md5: number;
    is_consent_date: boolean;
    file_paths: string[];
    segments?: TrendSegment[];
};

type ActivityBucket = {
    hourStart: string;
    label: string;
    total: number;
    segments: TrendSegment[];
};

type PrintTableColumn = {
    key: string;
    label: string;
    className?: string;
};

type PrintTableRow = Record<string, React.ReactNode> & { id: string };

type PrintMetricCardRow = {
    id: string;
    title: string;
    subtitle?: string;
    metrics: Array<{ label: string; value: React.ReactNode }>;
};

function PrintTable({
    columns,
    rows,
    emptyLabel,
}: {
    columns: PrintTableColumn[];
    rows: PrintTableRow[];
    emptyLabel: string;
}) {
    return (
        <div className="monitoring-print-only rounded-md border border-slate-300 bg-white p-3">
            {rows.length === 0 ? (
                <p className="text-sm text-slate-600">{emptyLabel}</p>
            ) : (
                <table className="w-full table-fixed border-collapse text-[11px] leading-4 text-slate-900">
                    <thead>
                        <tr>
                            {columns.map((column) => (
                                <th
                                    key={column.key}
                                    className={`border border-slate-300 bg-slate-100 px-2 py-1 text-left font-semibold ${column.className ?? ""}`}
                                >
                                    {column.label}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row) => (
                            <tr key={row.id}>
                                {columns.map((column) => (
                                    <td key={column.key} className="border border-slate-300 px-2 py-1 align-top break-words">
                                        {row[column.key] ?? "N/A"}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}

function PrintMetricCards({ rows, emptyLabel }: { rows: PrintMetricCardRow[]; emptyLabel: string }) {
    return (
        <div className="monitoring-print-only">
            {rows.length === 0 ? (
                <div className="rounded-md border border-slate-300 bg-white p-3 text-sm text-slate-600">{emptyLabel}</div>
            ) : (
                <div className="grid gap-3">
                    {rows.map((row) => (
                        <article key={row.id} className="rounded-md border border-slate-300 bg-white p-3 text-slate-900">
                            <div className="mb-2 border-b border-slate-200 pb-2">
                                <h3 className="text-sm font-semibold">{row.title}</h3>
                                {row.subtitle ? <p className="text-[11px] text-slate-600">{row.subtitle}</p> : null}
                            </div>
                            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] leading-4">
                                {row.metrics.map((metric) => (
                                    <div key={metric.label} className="break-inside-avoid">
                                        <dt className="font-medium text-slate-600">{metric.label}</dt>
                                        <dd className="mt-0.5 break-words">{metric.value}</dd>
                                    </div>
                                ))}
                            </dl>
                        </article>
                    ))}
                </div>
            )}
        </div>
    );
}

const mapDataSourceToCoverageModality = (value: string | null | undefined): CoverageModalityKey | null => {
    const normalized = normalizeDataSourceName(value).toLowerCase();

    if (normalized.includes("mindlamp_qc") || normalized.includes("mindlampqc")) return "mindlamp_qc_sharepoint";
    if (normalized.includes("upenn_recap") || normalized.includes("upenn_redcap") || normalized.includes("penncnb")) return "penncnb";
    if (normalized.includes("redcap")) return "redcap";
    if (normalized.includes("eeg")) return "eeg_sharepoint";
    if (normalized.includes("mindlamp")) return "mindlamp";
    if (normalized.includes("cantab")) return "cantab";
    if (normalized.includes("transcript") || normalized.includes("transcripts")) return "transcript_sharepoint";

    return null;
};

const COVERAGE_MODALITY_LABEL_BY_KEY: Record<CoverageModalityKey, string> = COVERAGE_MODALITY_COLUMNS.reduce(
    (acc, column) => {
        acc[column.key] = column.label;
        return acc;
    },
    {
        redcap: "REDCap",
        eeg_sharepoint: "EEG (SharePoint)",
        mindlamp: "MindLAMP",
        mindlamp_qc_sharepoint: "MindLAMP QC (SharePoint)",
        penncnb: "PennCNB (UPENN_recap)",
        cantab: "CANTAB",
        transcript_sharepoint: "Transcript (SharePoint)",
    }
);

const TREND_MODALITY_COLOR_BY_KEY: Record<CoverageModalityKey, string> = {
    redcap: "#f59e0b",
    eeg_sharepoint: "#0ea5e9",
    mindlamp: "#10b981",
    mindlamp_qc_sharepoint: "#ec4899",
    penncnb: "#6366f1",
    cantab: "#f97316",
    transcript_sharepoint: "#14b8a6",
};

const toGroupedDataSourceLabel = (value: string | null | undefined): string => {
    const modality = mapDataSourceToCoverageModality(value);
    if (modality) {
        return COVERAGE_MODALITY_LABEL_BY_KEY[modality];
    }

    const normalized = normalizeDataSourceName(value);
    return normalized && normalized !== "unknown" ? normalized : "N/A";
};

export default function MonitoringPage() {
    const monitoringIcon = <Terminal className="h-8 w-8" />;
    const { resolvedTheme } = useTheme();
    const isDarkMode = resolvedTheme === "dark";

    const [projectIdInput, setProjectIdInput] = React.useState("Procan");
    const [projectId, setProjectId] = React.useState("Procan");
    const [data, setData] = React.useState<MonitoringResponse | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [activeTrendTab, setActiveTrendTab] = React.useState<string>("all");
    const [trendSubjectFilter, setTrendSubjectFilter] = React.useState("");
    const [pdfGeneratedAt, setPdfGeneratedAt] = React.useState<string | null>(null);

    const fetchMonitoring = React.useCallback(async (requestedProjectId: string) => {
        setLoading(true);
        try {
            const response = await fetch(`/api/v1/monitoring/${encodeURIComponent(requestedProjectId)}`);
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(errorText || "Failed to fetch monitoring data");
            }

            const payload: MonitoringResponse = await response.json();
            setData(payload);
        } catch (error) {
            console.error(error);
            setData(null);
            toast.error("Failed to load monitoring data");
        } finally {
            setLoading(false);
        }
    }, []);

    React.useEffect(() => {
        fetchMonitoring(projectId);
    }, [projectId, fetchMonitoring]);

    const trendTabOptions = React.useMemo(() => {
        const available = new Set<CoverageModalityKey>();
        for (const row of data?.data_pull_trend_by_subject_and_modality ?? []) {
            if (row.modality_key && COVERAGE_MODALITY_COLUMNS.some((column) => column.key === row.modality_key)) {
                available.add(row.modality_key as CoverageModalityKey);
            }
        }

        return [
            { key: "all", label: "All" },
            ...COVERAGE_MODALITY_COLUMNS
                .filter((column) => available.has(column.key))
                .map((column) => ({ key: column.key, label: column.label })),
        ];
    }, [data]);

    React.useEffect(() => {
        if (!trendTabOptions.some((tab) => tab.key === activeTrendTab)) {
            setActiveTrendTab("all");
        }
    }, [activeTrendTab, trendTabOptions]);

    const trendBreakdownBySubjectDay = React.useMemo(() => {
        const grouped = new Map<string, Record<CoverageModalityKey, number>>();

        for (const row of data?.data_pull_trend_by_subject_and_modality ?? []) {
            if (!row.modality_key || !COVERAGE_MODALITY_COLUMNS.some((column) => column.key === row.modality_key)) {
                continue;
            }

            const dayKey = asDateKey(row.day) ?? row.day;
            const compositeKey = `${row.subject_id}::${dayKey}`;

            if (!grouped.has(compositeKey)) {
                grouped.set(compositeKey, {
                    redcap: 0,
                    eeg_sharepoint: 0,
                    mindlamp: 0,
                    mindlamp_qc_sharepoint: 0,
                    penncnb: 0,
                    cantab: 0,
                    transcript_sharepoint: 0,
                });
            }

            const counts = grouped.get(compositeKey);
            if (!counts) continue;

            const modalityKey = row.modality_key as CoverageModalityKey;
            counts[modalityKey] += row.pulls_with_unique_file_md5;
        }

        const segmentsByKey = new Map<string, TrendSegment[]>();

        for (const [compositeKey, counts] of grouped.entries()) {
            const segments = COVERAGE_MODALITY_COLUMNS
                .map((column) => ({
                    key: column.key,
                    label: column.label,
                    count: counts[column.key],
                    color: TREND_MODALITY_COLOR_BY_KEY[column.key],
                }))
                .filter((segment) => segment.count > 0);

            segmentsByKey.set(compositeKey, segments);
        }

        return segmentsByKey;
    }, [data]);

    const trendBySubject = React.useMemo(() => {
        const grouped = new Map<string, TrendPoint[]>();

        if (activeTrendTab === "all") {
            for (const row of data?.data_pull_trend_by_subject ?? []) {
                if (!grouped.has(row.subject_id)) {
                    grouped.set(row.subject_id, []);
                }

                const dayKey = asDateKey(row.day) ?? row.day;
                const compositeKey = `${row.subject_id}::${dayKey}`;
                const knownSegments = trendBreakdownBySubjectDay.get(compositeKey) ?? [];

                grouped.get(row.subject_id)?.push({
                    day: row.day,
                    pulls_with_unique_file_md5: row.pulls_with_unique_file_md5,
                    is_consent_date: row.is_consent_date,
                    file_paths: row.file_paths,
                    segments: knownSegments,
                });
            }
        } else {
            for (const row of data?.data_pull_trend_by_subject_and_modality ?? []) {
                if (row.modality_key !== activeTrendTab) continue;
                if (!grouped.has(row.subject_id)) {
                    grouped.set(row.subject_id, []);
                }
                grouped.get(row.subject_id)?.push({
                    day: row.day,
                    pulls_with_unique_file_md5: row.pulls_with_unique_file_md5,
                    is_consent_date: row.is_consent_date,
                    file_paths: row.file_paths,
                });
            }
        }

        for (const entries of grouped.values()) {
            entries.sort((a, b) => b.day.localeCompare(a.day));
        }

        return grouped;
    }, [activeTrendTab, data, trendBreakdownBySubjectDay]);

    const highestTrendCount = React.useMemo(() => {
        const allValues = [...trendBySubject.values()].flatMap((rows) => rows.map((row) => row.pulls_with_unique_file_md5));
        return allValues.length > 0 ? Math.max(...allValues) : 1;
    }, [trendBySubject]);

    const filteredTrendEntries = React.useMemo(() => {
        const normalizedFilter = trendSubjectFilter.trim().toLowerCase();
        const entries = [...trendBySubject.entries()];

        if (!normalizedFilter) {
            return entries;
        }

        return entries.filter(([subjectId]) => subjectId.toLowerCase().includes(normalizedFilter));
    }, [trendBySubject, trendSubjectFilter]);

    const activeTrendModalityColor = React.useMemo(() => {
        if (activeTrendTab === "all") {
            return null;
        }

        if (COVERAGE_MODALITY_COLUMNS.some((column) => column.key === activeTrendTab)) {
            return TREND_MODALITY_COLOR_BY_KEY[activeTrendTab as CoverageModalityKey];
        }

        return null;
    }, [activeTrendTab]);

    const consentDateBySubject = React.useMemo(() => {
        const map = new Map<string, string | null>();
        for (const row of data?.consent_dates_by_subject ?? []) {
            map.set(row.subject_id, row.consent_date);
        }
        return map;
    }, [data]);

    const coverageColumns = React.useMemo<GridColDef[]>(() => {
        const baseColumns: GridColDef[] = [
            { field: "subject_id", headerName: "Participant ID", minWidth: 180, flex: 1 },
            { field: "total_pulls", headerName: "All Pull Records", type: "number", minWidth: 150 },
            { field: "pulls_with_unique_file_md5", headerName: "Unique Files (MD5)", type: "number", minWidth: 170 },
        ];

        const modalityColumns = COVERAGE_MODALITY_COLUMNS.map((column): GridColDef => ({
            field: column.key,
            headerName: column.label,
            type: "number",
            minWidth: 180,
            renderCell: (params) => {
                const value = typeof params.value === "number" ? params.value : 0;
                if (value > 0) {
                    return <span className="text-xs font-medium">{value}</span>;
                }

                return (
                    <span className="inline-flex items-center rounded-full border border-amber-300/60 bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:border-amber-500/50 dark:bg-amber-900/30 dark:text-amber-300">
                        N/A
                    </span>
                );
            },
        }));

        return [...baseColumns, ...modalityColumns];
    }, []);

    const uniqueFilePathColumns = React.useMemo<GridColDef[]>(
        () => [
            { field: "subject_id", headerName: "Participant ID", minWidth: 180, flex: 1 },
            ...COVERAGE_MODALITY_COLUMNS.map((column): GridColDef => ({
                field: column.key,
                headerName: column.label,
                type: "number",
                minWidth: 180,
                renderCell: (params) => {
                    const value = typeof params.value === "number" ? params.value : 0;
                    if (value > 0) {
                        return <span className="text-xs font-medium">{value}</span>;
                    }

                    return (
                        <span className="inline-flex items-center rounded-full border border-amber-300/60 bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:border-amber-500/50 dark:bg-amber-900/30 dark:text-amber-300">
                            N/A
                        </span>
                    );
                },
            })),
        ],
        []
    );

    const uniqueFilePathRows = React.useMemo(() => {
        const baseBySubject = new Map<string, Record<CoverageModalityKey, number>>();

        for (const row of data?.data_pull_coverage_by_subject ?? []) {
            baseBySubject.set(row.subject_id, {
                redcap: 0,
                eeg_sharepoint: 0,
                mindlamp: 0,
                mindlamp_qc_sharepoint: 0,
                penncnb: 0,
                cantab: 0,
                transcript_sharepoint: 0,
            });
        }

        for (const row of data?.unique_file_paths_by_data_source ?? []) {
            const modality = mapDataSourceToCoverageModality(row.data_source_name);
            if (!modality) continue;
            if (!baseBySubject.has(row.subject_id)) {
                baseBySubject.set(row.subject_id, {
                    redcap: 0,
                    eeg_sharepoint: 0,
                    mindlamp: 0,
                    mindlamp_qc_sharepoint: 0,
                    penncnb: 0,
                    cantab: 0,
                    transcript_sharepoint: 0,
                });
            }
            const existing = baseBySubject.get(row.subject_id);
            if (existing) {
                existing[modality] += row.unique_file_paths ?? 0;
            }
        }

        return [...baseBySubject.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([subjectId, modalityCounts]) => ({
                id: subjectId,
                subject_id: subjectId,
                ...modalityCounts,
            }));
    }, [data]);

    const coverageRows = React.useMemo(() => {
        return (data?.data_pull_coverage_by_subject ?? []).map((row) => {
            const modalityUniqueMd5 = COVERAGE_MODALITY_COLUMNS.reduce<Record<CoverageModalityKey, number>>((acc, column) => {
                const uniqueMd5 = new Set(
                    row.recent_pull_items
                        .filter((item) => mapDataSourceToCoverageModality(item.data_source_name) === column.key)
                        .map((item) => item.file_md5)
                        .filter((value): value is string => Boolean(value))
                );

                // If there is exactly one unique pull, it must render as 1 (not N/A).
                acc[column.key] = uniqueMd5.size;
                return acc;
            }, {
                redcap: 0,
                eeg_sharepoint: 0,
                mindlamp: 0,
                mindlamp_qc_sharepoint: 0,
                penncnb: 0,
                cantab: 0,
                transcript_sharepoint: 0,
            });

            return {
                id: row.subject_id,
                subject_id: row.subject_id,
                total_pulls: row.total_pulls,
                pulls_with_unique_file_md5: row.pulls_with_unique_file_md5,
                ...modalityUniqueMd5,
            };
        });
    }, [data]);

    const gridSx = React.useMemo(
        () => ({
            border: 0,
            "& .MuiDataGrid-columnHeaders": {
                backgroundColor: isDarkMode ? "hsl(240 10% 10%)" : "hsl(210 20% 96%)",
            },
            "& .MuiDataGrid-row:hover": {
                backgroundColor: isDarkMode ? "hsl(240 8% 16%)" : "hsl(210 40% 98%)",
            },
            "& .MuiDataGrid-cell, & .MuiDataGrid-columnHeader": {
                borderColor: isDarkMode ? "hsl(240 6% 20%)" : "hsl(210 14% 89%)",
            },
            "& .MuiDataGrid-footerContainer": {
                borderTop: "none",
            },
        }),
        [isDarkMode]
    );

    const muiTheme = React.useMemo(
        () =>
            createTheme({
                palette: {
                    mode: isDarkMode ? "dark" : "light",
                },
            }),
        [isDarkMode]
    );

    const consentBySubjectColumns = React.useMemo<GridColDef[]>(
        () => [
            { field: "subject_id", headerName: "Subject ID", minWidth: 180, flex: 1.2 },
            { field: "site_id", headerName: "Site ID", minWidth: 160, flex: 1 },
            { field: "consent_date", headerName: "Consent Date", minWidth: 170, flex: 1 },
            { field: "mindlamp_ids", headerName: "MindLAMP IDs", minWidth: 220, flex: 1.5 },
            { field: "cantab_ids", headerName: "CANTAB IDs", minWidth: 220, flex: 1.5 },
        ],
        []
    );

    const consentBySubjectRows = React.useMemo(
        () =>
            (data?.subjects_with_consent_date ?? []).map((row) => ({
                id: row.subject_id,
                subject_id: row.subject_id,
                site_id: row.site_id,
                consent_date: asReadableDate(row.consent_date),
                mindlamp_ids: row.mindlamp_id || "N/A",
                cantab_ids: row.cantab_id || "N/A",
            })),
        [data]
    );

    const newlyAddedColumns = React.useMemo<GridColDef[]>(
        () => [
            { field: "subject_id", headerName: "Subject ID", minWidth: 180, flex: 1 },
            { field: "site_id", headerName: "Site ID", minWidth: 140, flex: 1 },
            { field: "created_at", headerName: "Created At", minWidth: 220, flex: 1.5 },
        ],
        []
    );

    const newlyAddedRows = React.useMemo(
        () =>
            (data?.newly_added_last_night ?? []).slice(0, 10).map((row) => ({
                id: `${row.subject_id}-${row.site_id}`,
                subject_id: row.subject_id,
                site_id: row.site_id,
                created_at: asLocalDateTime(row.created_at),
            })),
        [data]
    );

    const subjectSiteMap = React.useMemo(() => {
        const map = new Map<string, string>();
        for (const row of data?.subjects_with_consent_date ?? []) {
            map.set(row.subject_id, row.site_id);
        }
        return map;
    }, [data]);

    const latestDataPullColumns = React.useMemo<GridColDef[]>(
        () => [
            { field: "pull_timestamp", headerName: "Pull Timestamp", minWidth: 220, flex: 1.3 },
            { field: "file_name", headerName: "File Name", minWidth: 280, flex: 1.8 },
            { field: "site_id", headerName: "Site", minWidth: 140, flex: 1 },
            { field: "subject_id", headerName: "Subject", minWidth: 180, flex: 1.2 },
            { field: "data_source_name", headerName: "Data Source", minWidth: 220, flex: 1.4 },
        ],
        []
    );

    const latestDataPullRows = React.useMemo(() => {
        const latestByMd5 = new Map<
            string,
            {
                file_md5: string;
                file_name: string;
                pull_timestamp: string;
                pull_timestamp_raw: string | null;
                pull_timestamp_ms: number;
                site_id: string;
                subject_id: string;
                data_source_name: string;
            }
        >();

        for (const row of data?.data_pull_coverage_by_subject ?? []) {
            const siteId = subjectSiteMap.get(row.subject_id) ?? "N/A";
            for (const item of row.recent_pull_items ?? []) {
                if (!item.file_md5) continue;

                const timeMs = item.pull_timestamp ? new Date(item.pull_timestamp).getTime() : Number.NEGATIVE_INFINITY;
                const existing = latestByMd5.get(item.file_md5);
                if (!existing || timeMs > existing.pull_timestamp_ms) {
                    latestByMd5.set(item.file_md5, {
                        file_md5: item.file_md5,
                        file_name: asFileName(item.file_path),
                        pull_timestamp: asLocalDateTime(item.pull_timestamp),
                        pull_timestamp_raw: item.pull_timestamp,
                        pull_timestamp_ms: Number.isNaN(timeMs) ? Number.NEGATIVE_INFINITY : timeMs,
                        site_id: siteId,
                        subject_id: row.subject_id,
                        data_source_name: toGroupedDataSourceLabel(item.data_source_name),
                    });
                }
            }
        }

        return [...latestByMd5.values()]
            .sort((a, b) => b.pull_timestamp_ms - a.pull_timestamp_ms)
            .slice(0, 200)
            .map((row) => ({
                id: row.file_md5,
                file_name: row.file_name,
                pull_timestamp: row.pull_timestamp,
                pull_timestamp_raw: row.pull_timestamp_raw,
                site_id: row.site_id,
                subject_id: row.subject_id,
                data_source_name: row.data_source_name,
            }));
    }, [data, subjectSiteMap]);

    const warningColumns = React.useMemo<GridColDef[]>(
        () => [
            { field: "timestamp", headerName: "Timestamp", minWidth: 220, flex: 1.2 },
            { field: "level", headerName: "Level", minWidth: 100 },
            { field: "message", headerName: "Message", minWidth: 450, flex: 3 },
            { field: "site_id", headerName: "Site", minWidth: 140, flex: 1 },
            { field: "subject_id", headerName: "Subject", minWidth: 170, flex: 1 },
            { field: "data_source_name", headerName: "Data Source", minWidth: 220, flex: 1.5 },
        ],
        []
    );

    const warningRows = React.useMemo(
        () =>
            (data?.last_warning_logs ?? []).map((row, index) => ({
                id: `${row.timestamp}-${index}`,
                timestamp: asLocalDateTime(row.timestamp),
                level: row.level,
                message: row.message || "N/A",
                site_id: row.site_id || "N/A",
                subject_id: row.subject_id || "N/A",
                data_source_name: row.data_source_name || "N/A",
            })),
        [data]
    );

    const handleSavePdf = React.useCallback(() => {
        const generatedAt = new Date().toLocaleString();
        setPdfGeneratedAt(generatedAt);

        window.setTimeout(() => {
            window.print();
        }, 0);
    }, []);

    const last48HourPullActivity = React.useMemo(() => {
        const end = new Date();
        end.setMinutes(0, 0, 0);

        const bucketMap = new Map<string, ActivityBucket>();
        for (let index = 47; index >= 0; index -= 1) {
            const bucketDate = new Date(end);
            bucketDate.setHours(bucketDate.getHours() - index);
            const key = bucketDate.toISOString();
            bucketMap.set(key, {
                hourStart: key,
                label: asReadableHour(key),
                total: 0,
                segments: [],
            });
        }

        const breakdownMap = new Map<string, Record<string, number>>();

        for (const row of data?.data_pull_activity_last_48h ?? []) {
            const hourKey = asHourKey(row.hour_start);
            if (!hourKey || !bucketMap.has(hourKey)) continue;

            if (!row.modality_key || !COVERAGE_MODALITY_COLUMNS.some((column) => column.key === row.modality_key)) {
                continue;
            }

            const modalityKey = row.modality_key;
            if (!breakdownMap.has(hourKey)) {
                breakdownMap.set(hourKey, {});
            }

            const counts = breakdownMap.get(hourKey);
            if (!counts) continue;
            counts[modalityKey] = (counts[modalityKey] ?? 0) + row.pull_count;
        }

        for (const [hourKey, counts] of breakdownMap.entries()) {
            const bucket = bucketMap.get(hourKey);
            if (!bucket) continue;

            const knownSegments = COVERAGE_MODALITY_COLUMNS
                .map((column) => ({
                    key: column.key,
                    label: column.label,
                    count: counts[column.key] ?? 0,
                    color: TREND_MODALITY_COLOR_BY_KEY[column.key],
                }))
                .filter((segment) => segment.count > 0);

            bucket.segments = knownSegments;
            bucket.total = bucket.segments.reduce((sum, segment) => sum + segment.count, 0);
        }

        const buckets = [...bucketMap.values()];
        const totalPulls = buckets.reduce((sum, bucket) => sum + bucket.total, 0);
        const highestTotal = Math.max(1, ...buckets.map((bucket) => bucket.total));
        const peakBucket = buckets.reduce<ActivityBucket | null>((currentPeak, bucket) => {
            if (!currentPeak || bucket.total > currentPeak.total) {
                return bucket;
            }
            return currentPeak;
        }, null);

        return {
            buckets,
            totalPulls,
            highestTotal,
            peakBucket,
            latestBucket: buckets[buckets.length - 1] ?? null,
        };
    }, [data]);

    const activityAxisTicks = React.useMemo(() => {
        const buckets = last48HourPullActivity.buckets;
        return buckets.flatMap((bucket, index) => {
            const isFirst = index === 0;
            const isLast = index === buckets.length - 1;
            const shouldLabel = isFirst || isLast || index % 6 === 0;

            if (!shouldLabel) {
                return [];
            }

            return [{
                key: bucket.hourStart,
                label: bucket.label,
                leftPercent: buckets.length === 1 ? 0 : (index / (buckets.length - 1)) * 100,
            }];
        });
    }, [last48HourPullActivity.buckets]);

    const consentPrintRows = React.useMemo<PrintTableRow[]>(
        () => consentBySubjectRows.map((row) => ({
            id: String(row.id),
            subject_id: row.subject_id,
            site_id: row.site_id,
            consent_date: row.consent_date,
            mindlamp_ids: row.mindlamp_ids,
            cantab_ids: row.cantab_ids,
        })),
        [consentBySubjectRows]
    );

    const newlyAddedPrintRows = React.useMemo<PrintTableRow[]>(
        () => newlyAddedRows.map((row) => ({
            id: String(row.id),
            subject_id: row.subject_id,
            site_id: row.site_id,
            created_at: row.created_at,
        })),
        [newlyAddedRows]
    );

    const latestDataPullPrintRows = React.useMemo<PrintTableRow[]>(
        () => latestDataPullRows.map((row) => ({
            id: String(row.id),
            pull_timestamp: row.pull_timestamp,
            file_name: row.file_name,
            site_id: row.site_id,
            subject_id: row.subject_id,
            data_source_name: row.data_source_name,
        })),
        [latestDataPullRows]
    );

    const warningPrintRows = React.useMemo<PrintTableRow[]>(
        () => warningRows.map((row) => ({
            id: String(row.id),
            timestamp: row.timestamp,
            level: row.level,
            message: row.message,
            site_id: row.site_id,
            subject_id: row.subject_id,
            data_source_name: row.data_source_name,
        })),
        [warningRows]
    );

    const uniqueFilePathPrintCards = React.useMemo<PrintMetricCardRow[]>(
        () => uniqueFilePathRows.map((row) => ({
            id: String(row.id),
            title: String(row.subject_id),
            subtitle: "Unique file paths by data source",
            metrics: COVERAGE_MODALITY_COLUMNS.map((column) => ({
                label: column.label,
                value: row[column.key],
            })),
        })),
        [uniqueFilePathRows]
    );

    const coveragePrintCards = React.useMemo<PrintMetricCardRow[]>(
        () => coverageRows.map((row) => ({
            id: String(row.id),
            title: String(row.subject_id),
            subtitle: `All Pull Records: ${row.total_pulls} | Unique Files (MD5): ${row.pulls_with_unique_file_md5}`,
            metrics: COVERAGE_MODALITY_COLUMNS.map((column) => ({
                label: column.label,
                value: row[column.key],
            })),
        })),
        [coverageRows]
    );

    return (
        <div className="monitoring-print-root container mx-auto flex max-w-6xl flex-col gap-6 p-6">
            <section className="monitoring-print-only rounded-lg border bg-white p-6 text-black">
                <div className="mb-4 border-b pb-4">
                    <h1 className="text-2xl font-semibold">Lochness Monitoring Report</h1>
                    <div className="mt-2 grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
                        <p><span className="font-medium">Project:</span> {projectId}</p>
                        <p><span className="font-medium">Generated:</span> {pdfGeneratedAt ?? new Date().toLocaleString()}</p>
                        <p><span className="font-medium">Route:</span> /monitoring/logs</p>
                    </div>
                </div>
            </section>
            <Heading icon={monitoringIcon} title="Monitoring" />

            <div className="monitoring-print-hide border rounded-lg p-4 bg-card text-card-foreground">
                <div className="flex flex-col md:flex-row md:items-end gap-3">
                    <div className="flex-1">
                        <label htmlFor="project-id" className="text-sm font-medium block mb-1">Project ID</label>
                        <Input
                            id="project-id"
                            value={projectIdInput}
                            onChange={(event) => setProjectIdInput(event.target.value)}
                            placeholder="Enter project id"
                        />
                    </div>
                    <Button
                        type="button"
                        onClick={() => setProjectId(projectIdInput.trim())}
                        disabled={!projectIdInput.trim() || loading}
                        className="gap-2"
                    >
                        <RefreshCcw className="h-4 w-4" />
                        Load Monitoring
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        onClick={handleSavePdf}
                        disabled={loading || !data}
                        className="gap-2"
                    >
                        <FileDown className="h-4 w-4" />
                        Save as PDF
                    </Button>
                </div>
            </div>

            {loading ? (
                <div className="border rounded-lg p-6 bg-card text-card-foreground text-sm text-muted-foreground">
                    Loading monitoring dashboard...
                </div>
            ) : !data ? (
                <div className="border rounded-lg p-6 bg-card text-card-foreground text-sm text-muted-foreground">
                    Monitoring data is unavailable.
                </div>
            ) : (
                <>
                    <section className="monitoring-print-section border rounded-lg p-4 bg-card text-card-foreground">
                        <h2 className="text-lg font-semibold mb-3">Summary</h2>
                        <div className="monitoring-print-hide overflow-x-auto">
                            <div className="grid min-w-[760px] grid-cols-3 gap-3 text-sm">
                                <div className="border rounded-md p-3">
                                    <p className="text-muted-foreground">Subjects With Consent Date</p>
                                    <p className="text-2xl font-semibold">{data.summary.subjects_missing_required_variables_count}</p>
                                </div>
                                <div className="border rounded-md p-3">
                                    <p className="text-muted-foreground">Sites With Any Consented Subject</p>
                                    <p className="text-2xl font-semibold">{data.summary.subjects_missing_required_variables_by_site.length}</p>
                                </div>
                                <div className="border rounded-md p-3">
                                    <p className="text-muted-foreground">Newly Added Subjects (Last 48 Hours)</p>
                                    <p className="text-2xl font-semibold">{data.summary.newly_added_last_night_count}</p>
                                </div>
                            </div>
                        </div>
                        <div className="monitoring-print-only rounded-md border border-slate-300 bg-white p-3">
                            <table className="w-full table-fixed border-collapse text-[11px] leading-4 text-slate-900">
                                <thead>
                                    <tr>
                                        <th className="w-[58%] border border-slate-300 bg-slate-100 px-2 py-1 text-left font-semibold">Metric</th>
                                        <th className="w-[42%] border border-slate-300 bg-slate-100 px-2 py-1 text-left font-semibold">Value</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td className="border border-slate-300 px-2 py-1">Subjects With Consent Date</td>
                                        <td className="border border-slate-300 px-2 py-1">{data.summary.subjects_missing_required_variables_count}</td>
                                    </tr>
                                    <tr>
                                        <td className="border border-slate-300 px-2 py-1">Sites With Any Consented Subject</td>
                                        <td className="border border-slate-300 px-2 py-1">{data.summary.subjects_missing_required_variables_by_site.length}</td>
                                    </tr>
                                    <tr>
                                        <td className="border border-slate-300 px-2 py-1">Newly Added Subjects (Last 48 Hours)</td>
                                        <td className="border border-slate-300 px-2 py-1">{data.summary.newly_added_last_night_count}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </section>

                    <section className="monitoring-print-section border rounded-lg p-4 bg-card text-card-foreground">
                        <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                            <div>
                                <h2 className="text-lg font-semibold">Latest Data Pulls, Last 48 Hours</h2>
                                <p className="text-sm text-muted-foreground">
                                    Hourly pull volume for the last 48 hours. Newest hour is on the right.
                                </p>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-3">
                                <div className="rounded-md border px-3 py-2">
                                    <p className="text-muted-foreground">Total Pulls</p>
                                    <p className="text-xl font-semibold">{last48HourPullActivity.totalPulls}</p>
                                </div>
                                <div className="rounded-md border px-3 py-2">
                                    <p className="text-muted-foreground">Current Hour</p>
                                    <p className="text-xl font-semibold">{last48HourPullActivity.latestBucket?.total ?? 0}</p>
                                </div>
                                <div className="col-span-2 rounded-md border px-3 py-2 md:col-span-1">
                                    <p className="text-muted-foreground">Peak Hour</p>
                                    <p className="text-base font-semibold">
                                        {last48HourPullActivity.peakBucket ? `${last48HourPullActivity.peakBucket.total} at ${last48HourPullActivity.peakBucket.label}` : "N/A"}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {last48HourPullActivity.totalPulls === 0 ? (
                            <div className="rounded-md border border-dashed p-6 text-sm text-muted-foreground">
                                No data pulls were recorded in the last 48 hours.
                            </div>
                        ) : (
                            <figure className="rounded-lg border bg-muted/20 p-4">
                                <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-muted-foreground">
                                    {COVERAGE_MODALITY_COLUMNS.map((column) => (
                                        <span key={column.key} className="inline-flex items-center gap-2">
                                            <span
                                                className="h-2.5 w-2.5 rounded-sm border border-black/10"
                                                style={{ backgroundColor: TREND_MODALITY_COLOR_BY_KEY[column.key] }}
                                                aria-hidden="true"
                                            />
                                            <span>{column.label}</span>
                                        </span>
                                    ))}
                                </div>

                                <div className="relative h-64">
                                    <div className="absolute inset-y-0 right-0 z-10 border-l-2 border-rose-500/90">
                                        <span className="absolute -top-6 right-0 translate-x-1/2 whitespace-nowrap rounded bg-rose-500 px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm">
                                            Now
                                        </span>
                                    </div>
                                    <div className="flex h-full items-end gap-1">
                                        {last48HourPullActivity.buckets.map((bucket) => {
                                            const heightPercent = bucket.total > 0
                                                ? Math.max(4, (bucket.total / last48HourPullActivity.highestTotal) * 100)
                                                : 2;
                                            const title = bucket.total > 0
                                                ? `${bucket.label}: ${bucket.total} pulls\n${bucket.segments.map((segment) => `${segment.label}: ${segment.count}`).join("\n")}`
                                                : `${bucket.label}: 0 pulls`;

                                            return (
                                                <div key={bucket.hourStart} className="group flex h-full flex-1 items-end" title={title}>
                                                    <div className="flex h-full w-full items-end">
                                                        <div
                                                            className="flex w-full flex-col justify-end overflow-hidden rounded-sm bg-border/30 transition-opacity group-hover:opacity-90"
                                                            style={{ height: `${heightPercent}%` }}
                                                        >
                                                            {bucket.total > 0 ? (
                                                                bucket.segments.map((segment) => (
                                                                    <div
                                                                        key={`${bucket.hourStart}-${segment.key}`}
                                                                        style={{
                                                                            height: `${(segment.count / bucket.total) * 100}%`,
                                                                            backgroundColor: segment.color,
                                                                        }}
                                                                    />
                                                                ))
                                                            ) : (
                                                                <div className="h-full w-full bg-border/50" />
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                <div className="mt-4">
                                    <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                                        Time (local)
                                    </p>
                                    <div className="relative h-10 border-t border-dashed border-border/70">
                                        {activityAxisTicks.map((tick) => (
                                            <div
                                                key={tick.key}
                                                className="absolute top-0"
                                                style={{ left: `${tick.leftPercent}%` }}
                                            >
                                                <div className="h-2 w-px -translate-x-1/2 bg-border/80" />
                                                <span className="absolute top-3 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] text-muted-foreground">
                                                    {tick.label}
                                                </span>
                                            </div>
                                        ))}
                                        <div className="absolute top-0 right-0">
                                            <div className="h-2 w-px -translate-x-1/2 bg-rose-500/90" />
                                            <span className="absolute -top-5 right-0 whitespace-nowrap text-[11px] font-medium text-rose-600 dark:text-rose-400">
                                                Current time
                                            </span>
                                        </div>
                                    </div>
                                </div>
                                <figcaption className="mt-2 text-xs text-muted-foreground">
                                    Each bar is one hour. Bar height shows total pull count, and stacked colors show the data-source mix within that hour.
                                </figcaption>
                            </figure>
                        )}
                    </section>

                    <section className="monitoring-print-section border rounded-lg p-4 bg-card text-card-foreground overflow-x-auto monitoring-print-grid">
                        <h2 className="text-lg font-semibold mb-3">Subjects With Consent Date</h2>
                        <div className="monitoring-print-hide">
                            <MuiThemeProvider theme={muiTheme}>
                                <div className="h-[320px] w-full">
                                    <DataGrid
                                        rows={consentBySubjectRows}
                                        columns={consentBySubjectColumns}
                                        sx={gridSx}
                                        disableRowSelectionOnClick
                                        hideFooterSelectedRowCount
                                        pageSizeOptions={[10, 25, 50]}
                                        initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
                                        localeText={{ noRowsLabel: "No records" }}
                                    />
                                </div>
                            </MuiThemeProvider>
                        </div>
                        <PrintTable
                            columns={[
                                { key: "subject_id", label: "Subject ID", className: "w-[21%]" },
                                { key: "site_id", label: "Site ID", className: "w-[9%]" },
                                { key: "consent_date", label: "Consent Date", className: "w-[15%]" },
                                { key: "mindlamp_ids", label: "MindLAMP ID", className: "w-[27%]" },
                                { key: "cantab_ids", label: "CANTAB ID", className: "w-[28%]" },
                            ]}
                            rows={consentPrintRows}
                            emptyLabel="No records"
                        />
                    </section>

                    <section className="monitoring-print-section border rounded-lg p-4 bg-card text-card-foreground overflow-x-auto monitoring-print-grid">
                        <h2 className="text-lg font-semibold mb-3">Newly Added Subjects (Last 48 Hours)</h2>
                        <div className="monitoring-print-hide">
                            <MuiThemeProvider theme={muiTheme}>
                                <div className="h-[320px] w-full">
                                    <DataGrid
                                        rows={newlyAddedRows}
                                        columns={newlyAddedColumns}
                                        sx={gridSx}
                                        disableRowSelectionOnClick
                                        hideFooterSelectedRowCount
                                        pageSizeOptions={[10, 25, 50]}
                                        initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
                                        localeText={{ noRowsLabel: "No records" }}
                                    />
                                </div>
                            </MuiThemeProvider>
                        </div>
                        <PrintTable
                            columns={[
                                { key: "subject_id", label: "Subject ID", className: "w-[28%]" },
                                { key: "site_id", label: "Site ID", className: "w-[16%]" },
                                { key: "created_at", label: "Created At", className: "w-[56%]" },
                            ]}
                            rows={newlyAddedPrintRows}
                            emptyLabel="No records"
                        />
                    </section>

                    <section className="monitoring-print-section border rounded-lg p-4 bg-card text-card-foreground overflow-x-auto monitoring-print-grid">
                        <h2 className="text-lg font-semibold mb-3">Unique File Paths by Data Source</h2>
                        {data.metadata?.notes?.files_available === false && (
                            <p className="text-xs text-muted-foreground mb-3">
                                File path metrics are unavailable because the `files` schema does not contain required source/path columns.
                            </p>
                        )}
                        <div className="monitoring-print-hide">
                            <MuiThemeProvider theme={muiTheme}>
                                <div className="h-[220px] w-full">
                                    <DataGrid
                                        rows={uniqueFilePathRows}
                                        columns={uniqueFilePathColumns}
                                        sx={gridSx}
                                        disableRowSelectionOnClick
                                        hideFooter
                                    />
                                </div>
                            </MuiThemeProvider>
                        </div>
                        <PrintMetricCards rows={uniqueFilePathPrintCards} emptyLabel="No file path metrics" />
                    </section>

                    <section className="monitoring-print-section border rounded-lg p-4 bg-card text-card-foreground overflow-x-auto monitoring-print-grid">
                        <h2 className="text-lg font-semibold mb-3">Data Pull Coverage</h2>
                        {data.metadata?.notes?.data_pulls_available === false && (
                            <p className="text-xs text-muted-foreground mb-3">
                                Data pull metrics are unavailable in this environment because `data_pulls` schema does not contain the required subject mapping columns.
                            </p>
                        )}
                        <div className="monitoring-print-hide">
                            <MuiThemeProvider theme={muiTheme}>
                                <div className="h-[420px] w-full">
                                    <DataGrid
                                        rows={coverageRows}
                                        columns={coverageColumns}
                                        sx={gridSx}
                                        disableRowSelectionOnClick
                                        hideFooterSelectedRowCount
                                        pageSizeOptions={[10, 25, 50]}
                                        initialState={{
                                            pagination: {
                                                paginationModel: { pageSize: 10, page: 0 },
                                            },
                                        }}
                                        localeText={{ noRowsLabel: "No records" }}
                                    />
                                </div>
                            </MuiThemeProvider>
                        </div>
                        <PrintMetricCards rows={coveragePrintCards} emptyLabel="No records" />
                    </section>

                    <section className="monitoring-print-section border rounded-lg p-4 bg-card text-card-foreground overflow-x-auto monitoring-print-grid">
                        <h2 className="text-lg font-semibold mb-3">Latest 200 data pulls</h2>
                        <div className="monitoring-print-hide">
                            <MuiThemeProvider theme={muiTheme}>
                                <div className="h-[360px] w-full">
                                    <DataGrid
                                        rows={latestDataPullRows}
                                        columns={latestDataPullColumns}
                                        sx={gridSx}
                                        disableRowSelectionOnClick
                                        hideFooterSelectedRowCount
                                        pageSizeOptions={[10, 20, 50]}
                                        initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
                                        localeText={{ noRowsLabel: "No data pulls" }}
                                    />
                                </div>
                            </MuiThemeProvider>
                        </div>
                        <PrintTable
                            columns={[
                                { key: "pull_timestamp", label: "Pull Timestamp", className: "w-[20%]" },
                                { key: "file_name", label: "File Name", className: "w-[28%]" },
                                { key: "site_id", label: "Site", className: "w-[10%]" },
                                { key: "subject_id", label: "Subject", className: "w-[16%]" },
                                { key: "data_source_name", label: "Data Source", className: "w-[26%]" },
                            ]}
                            rows={latestDataPullPrintRows}
                            emptyLabel="No data pulls"
                        />
                    </section>

                    <section className="monitoring-print-section border rounded-lg p-4 bg-card text-card-foreground">
                        <div className="flex items-center gap-2 mb-3">
                            <BarChart3 className="h-5 w-5" />
                            <h2 className="text-lg font-semibold">Pull Trend (daily, pulls with unique file_md5, newest first)</h2>
                        </div>
                        <Tabs value={activeTrendTab} onValueChange={setActiveTrendTab} className="w-full">
                            <TabsList className="mb-3 flex h-auto w-full flex-wrap justify-start gap-2">
                                {trendTabOptions.map((tab) => (
                                    <TabsTrigger key={tab.key} value={tab.key}>
                                        <span className="inline-flex items-center gap-2">
                                            {tab.key !== "all" && COVERAGE_MODALITY_COLUMNS.some((column) => column.key === tab.key) ? (
                                                <span
                                                    className="h-2 w-2 rounded-full border border-black/10"
                                                    style={{ backgroundColor: TREND_MODALITY_COLOR_BY_KEY[tab.key as CoverageModalityKey] }}
                                                    aria-hidden="true"
                                                />
                                            ) : null}
                                            <span>{tab.label}</span>
                                        </span>
                                    </TabsTrigger>
                                ))}
                            </TabsList>
                        </Tabs>
                        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                            <div className="w-full md:max-w-sm">
                                <label htmlFor="trend-subject-filter" className="mb-1 block text-sm font-medium">
                                    Filter by Subject ID
                                </label>
                                <Input
                                    id="trend-subject-filter"
                                    value={trendSubjectFilter}
                                    onChange={(event) => setTrendSubjectFilter(event.target.value)}
                                    placeholder="Type a subject ID"
                                />
                            </div>
                            <p className="text-sm text-muted-foreground">
                                Showing {filteredTrendEntries.length} subject{filteredTrendEntries.length === 1 ? "" : "s"}
                            </p>
                        </div>
                        {activeTrendTab === "all" && (
                            <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-muted-foreground">
                                <span>Segment colors show each data type&apos;s share of the day&apos;s total.</span>
                                {COVERAGE_MODALITY_COLUMNS.map((column) => (
                                    <span key={column.key} className="inline-flex items-center gap-2">
                                        <span
                                            className="h-2.5 w-2.5 rounded-sm border border-black/10"
                                            style={{ backgroundColor: TREND_MODALITY_COLOR_BY_KEY[column.key] }}
                                            aria-hidden="true"
                                        />
                                        <span>{column.label}</span>
                                    </span>
                                ))}
                            </div>
                        )}
                        <div className="space-y-4">
                            {filteredTrendEntries.length === 0 ? (
                                <p className="text-sm text-muted-foreground">No trend data for the current modality and subject filter</p>
                            ) : (
                                filteredTrendEntries.map(([subjectId, points]) => {
                                    const consentDateRaw = consentDateBySubject.get(subjectId) ?? null;
                                    const consentDateKey = asDateKey(consentDateRaw);

                                    return (
                                        <div key={subjectId} className="border rounded-md p-3">
                                            <h3 className="text-sm font-semibold">{subjectId}</h3>
                                            <p className="mb-2 text-xs text-muted-foreground">
                                                Consent date: {asReadableDate(consentDateKey ?? consentDateRaw)}
                                            </p>
                                            <div className="space-y-2">
                                                {points.map((point) => {
                                                    const widthPercent = Math.max(4, (point.pulls_with_unique_file_md5 / highestTrendCount) * 100);
                                                    const dayKey = asDateKey(point.day);
                                                    const isConsentDate = Boolean(point.is_consent_date);
                                                    const hasFiles = point.file_paths.length > 0;
                                                    const stackedSegments = point.segments?.filter((segment) => segment.count > 0) ?? [];
                                                    const showStackedSegments = activeTrendTab === "all" && stackedSegments.length > 0;
                                                    const nonStackedBarColor = activeTrendModalityColor ?? (isConsentDate ? "#0ea5e9" : "#10b981");
                                                    const consentOutlineStyle = isConsentDate
                                                        ? {
                                                            boxShadow: `inset 0 0 0 1px ${activeTrendModalityColor ?? "#0ea5e9"}`,
                                                        }
                                                        : undefined;
                                                    return (
                                                        <details key={`${subjectId}-${point.day}`} className="space-y-2">
                                                            <summary className="list-none">
                                                                <div className="grid grid-cols-[160px_1fr_160px_60px_90px] gap-2 items-center text-xs">
                                                                    <span>{asReadableDate(dayKey ?? point.day)}</span>
                                                                    <div
                                                                        className="h-3 overflow-hidden rounded bg-muted"
                                                                        style={consentOutlineStyle}
                                                                    >
                                                                        <div className="flex h-full overflow-hidden rounded" style={{ width: `${widthPercent}%` }}>
                                                                            {showStackedSegments ? (
                                                                                stackedSegments.map((segment) => (
                                                                                    <div
                                                                                        key={`${subjectId}-${point.day}-${segment.key}`}
                                                                                        className="h-full first:rounded-l last:rounded-r"
                                                                                        style={{
                                                                                            width: `${(segment.count / point.pulls_with_unique_file_md5) * 100}%`,
                                                                                            backgroundColor: segment.color,
                                                                                        }}
                                                                                        title={`${segment.label}: ${segment.count}`}
                                                                                    />
                                                                                ))
                                                                            ) : (
                                                                                <div
                                                                                    className="h-full w-full"
                                                                                    style={{ backgroundColor: nonStackedBarColor }}
                                                                                />
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                    {hasFiles ? (
                                                                        <span className="inline-flex w-fit cursor-pointer items-center rounded-md border border-border/60 bg-muted/40 px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted">
                                                                            Browse {point.file_paths.length} file name{point.file_paths.length === 1 ? "" : "s"}
                                                                        </span>
                                                                    ) : (
                                                                        <span />
                                                                    )}
                                                                    <span>{point.pulls_with_unique_file_md5}</span>
                                                                    {isConsentDate ? (
                                                                        <span className="inline-flex w-fit items-center rounded-full border border-sky-300/60 bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-800 dark:border-sky-500/50 dark:bg-sky-900/30 dark:text-sky-300">
                                                                            Consent
                                                                        </span>
                                                                    ) : (
                                                                        <span />
                                                                    )}
                                                                </div>
                                                            </summary>
                                                            {hasFiles ? (
                                                                <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 sm:ml-[168px]">
                                                                    <ul className="max-h-32 space-y-1 overflow-y-auto pr-1 text-[11px] text-foreground/90">
                                                                        {point.file_paths.map((filePath, index) => (
                                                                            <li key={`${subjectId}-${point.day}-${filePath}-${index}`} className="truncate" title={filePath}>
                                                                                {asFileName(filePath)}
                                                                            </li>
                                                                        ))}
                                                                    </ul>
                                                                </div>
                                                            ) : null}
                                                        </details>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </section>

                    <section className="monitoring-print-section border rounded-lg p-4 bg-card text-card-foreground overflow-x-auto monitoring-print-grid">
                        <h2 className="text-lg font-semibold mb-3">Last 20 Warning Logs</h2>
                        <div className="monitoring-print-hide">
                            <MuiThemeProvider theme={muiTheme}>
                                <div className="h-[360px] w-full">
                                    <DataGrid
                                        rows={warningRows}
                                        columns={warningColumns}
                                        sx={gridSx}
                                        disableRowSelectionOnClick
                                        hideFooterSelectedRowCount
                                        pageSizeOptions={[10, 20, 50]}
                                        initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
                                        localeText={{ noRowsLabel: "No warning logs" }}
                                    />
                                </div>
                            </MuiThemeProvider>
                        </div>
                        <PrintTable
                            columns={[
                                { key: "timestamp", label: "Timestamp", className: "w-[15%]" },
                                { key: "level", label: "Level", className: "w-[8%]" },
                                { key: "message", label: "Message", className: "w-[39%]" },
                                { key: "site_id", label: "Site", className: "w-[8%]" },
                                { key: "subject_id", label: "Subject", className: "w-[12%]" },
                                { key: "data_source_name", label: "Data Source", className: "w-[18%]" },
                            ]}
                            rows={warningPrintRows}
                            emptyLabel="No warning logs"
                        />
                    </section>
                </>
            )}
        </div>
    );
}
