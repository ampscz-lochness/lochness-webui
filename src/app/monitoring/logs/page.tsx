"use client"
import * as React from "react";
import { DataGrid, type GridColDef } from "@mui/x-data-grid";
import { ThemeProvider as MuiThemeProvider, createTheme } from "@mui/material/styles";
import { useTheme } from "next-themes";

import { BarChart3, RefreshCcw, Terminal } from "lucide-react";
import { toast } from "sonner";

import { Heading } from "@/components/heading";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type MonitoringResponse = {
    project_id: string;
    summary: {
        subjects_missing_required_variables_count: number;
        subjects_missing_required_variables_by_site: Array<{ site_id: string; count: number; subject_ids: string[] }>;
        newly_added_last_night_count: number;
    };
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
    data_pull_trend_by_subject: Array<{ subject_id: string; day: string; pulls_with_unique_file_md5: number; is_consent_date: boolean }>;
    data_pull_trend_by_subject_and_modality: Array<{
        subject_id: string;
        modality_key: string | null;
        day: string;
        pulls_with_unique_file_md5: number;
        is_consent_date: boolean;
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

    const trendBySubject = React.useMemo(() => {
        const grouped = new Map<string, Array<{ day: string; pulls_with_unique_file_md5: number; is_consent_date: boolean }>>();

        if (activeTrendTab === "all") {
            for (const row of data?.data_pull_trend_by_subject ?? []) {
                if (!grouped.has(row.subject_id)) {
                    grouped.set(row.subject_id, []);
                }
                grouped.get(row.subject_id)?.push({
                    day: row.day,
                    pulls_with_unique_file_md5: row.pulls_with_unique_file_md5,
                    is_consent_date: row.is_consent_date,
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
                });
            }
        }

        for (const entries of grouped.values()) {
            entries.sort((a, b) => b.day.localeCompare(a.day));
        }

        return grouped;
    }, [activeTrendTab, data]);

    const highestTrendCount = React.useMemo(() => {
        const allValues = [...trendBySubject.values()].flatMap((rows) => rows.map((row) => row.pulls_with_unique_file_md5));
        return allValues.length > 0 ? Math.max(...allValues) : 1;
    }, [trendBySubject]);

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

    const consentBySiteColumns = React.useMemo<GridColDef[]>(
        () => [
            { field: "site_id", headerName: "Site ID", minWidth: 160, flex: 1 },
            { field: "subject_ids", headerName: "Subject IDs", minWidth: 300, flex: 2 },
            { field: "count", headerName: "Count", type: "number", minWidth: 110 },
        ],
        []
    );

    const consentBySiteRows = React.useMemo(
        () =>
            (data?.summary.subjects_missing_required_variables_by_site ?? []).map((row) => ({
                id: row.site_id,
                site_id: row.site_id,
                subject_ids: row.subject_ids?.join(", ") || "N/A",
                count: row.count,
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
        for (const row of data?.summary.subjects_missing_required_variables_by_site ?? []) {
            for (const subjectId of row.subject_ids) {
                map.set(subjectId, row.site_id);
            }
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

    return (
        <div className="container mx-auto p-6 max-w-6xl flex flex-col gap-6">
            <Heading icon={monitoringIcon} title="Monitoring" />

            <div className="border rounded-lg p-4 bg-card text-card-foreground">
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
                    <section className="border rounded-lg p-4 bg-card text-card-foreground">
                        <h2 className="text-lg font-semibold mb-3">Summary</h2>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                            <div className="border rounded-md p-3">
                                <p className="text-muted-foreground">Subjects With Consent Date</p>
                                <p className="text-2xl font-semibold">{data.summary.subjects_missing_required_variables_count}</p>
                            </div>
                            <div className="border rounded-md p-3">
                                <p className="text-muted-foreground">Sites With Any Consented Subject</p>
                                <p className="text-2xl font-semibold">{data.summary.subjects_missing_required_variables_by_site.length}</p>
                            </div>
                            <div className="border rounded-md p-3">
                                <p className="text-muted-foreground">Newly Added Subjects Last Night</p>
                                <p className="text-2xl font-semibold">{data.summary.newly_added_last_night_count}</p>
                            </div>
                        </div>
                    </section>

                    <section className="border rounded-lg p-4 bg-card text-card-foreground overflow-x-auto">
                        <h2 className="text-lg font-semibold mb-3">Subjects With Consent Date</h2>
                        <MuiThemeProvider theme={muiTheme}>
                            <div className="h-[320px] w-full">
                                <DataGrid
                                    rows={consentBySiteRows}
                                    columns={consentBySiteColumns}
                                    sx={gridSx}
                                    disableRowSelectionOnClick
                                    hideFooterSelectedRowCount
                                    pageSizeOptions={[10, 25, 50]}
                                    initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
                                    localeText={{ noRowsLabel: "No records" }}
                                />
                            </div>
                        </MuiThemeProvider>
                    </section>

                    <section className="border rounded-lg p-4 bg-card text-card-foreground overflow-x-auto">
                        <h2 className="text-lg font-semibold mb-3">Newly Added Subjects</h2>
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
                    </section>

                    <section className="border rounded-lg p-4 bg-card text-card-foreground overflow-x-auto">
                        <h2 className="text-lg font-semibold mb-3">Unique File Paths by Data Source</h2>
                        {data.metadata?.notes?.files_available === false && (
                            <p className="text-xs text-muted-foreground mb-3">
                                File path metrics are unavailable because the `files` schema does not contain required source/path columns.
                            </p>
                        )}
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
                    </section>

                    <section className="border rounded-lg p-4 bg-card text-card-foreground overflow-x-auto">
                        <h2 className="text-lg font-semibold mb-3">Data Pull Coverage</h2>
                        {data.metadata?.notes?.data_pulls_available === false && (
                            <p className="text-xs text-muted-foreground mb-3">
                                Data pull metrics are unavailable in this environment because `data_pulls` schema does not contain the required subject mapping columns.
                            </p>
                        )}
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
                    </section>

                    <section className="border rounded-lg p-4 bg-card text-card-foreground overflow-x-auto">
                        <h2 className="text-lg font-semibold mb-3">Latest 200 data pulls</h2>
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
                    </section>

                    <section className="border rounded-lg p-4 bg-card text-card-foreground">
                        <div className="flex items-center gap-2 mb-3">
                            <BarChart3 className="h-5 w-5" />
                            <h2 className="text-lg font-semibold">Pull Trend (daily, pulls with unique file_md5, newest first)</h2>
                        </div>
                        <Tabs value={activeTrendTab} onValueChange={setActiveTrendTab} className="w-full">
                            <TabsList className="mb-3 flex h-auto w-full flex-wrap justify-start gap-2">
                                {trendTabOptions.map((tab) => (
                                    <TabsTrigger key={tab.key} value={tab.key}>
                                        {tab.label}
                                    </TabsTrigger>
                                ))}
                            </TabsList>
                        </Tabs>
                        <div className="space-y-4">
                            {[...trendBySubject.entries()].length === 0 ? (
                                <p className="text-sm text-muted-foreground">No trend data for this modality</p>
                            ) : (
                                [...trendBySubject.entries()].map(([subjectId, points]) => {
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
                                                    return (
                                                        <div key={`${subjectId}-${point.day}`} className="grid grid-cols-[160px_1fr_60px_90px] gap-2 items-center text-xs">
                                                            <span>{asReadableDate(dayKey ?? point.day)}</span>
                                                            <div
                                                                className={`h-3 overflow-hidden rounded bg-muted ${isConsentDate ? "ring-1 ring-sky-500/70" : ""}`}
                                                            >
                                                                <div
                                                                    className={`h-full ${isConsentDate ? "bg-sky-500" : "bg-emerald-500"}`}
                                                                    style={{ width: `${widthPercent}%` }}
                                                                />
                                                            </div>
                                                            <span>{point.pulls_with_unique_file_md5}</span>
                                                            {isConsentDate ? (
                                                                <span className="inline-flex w-fit items-center rounded-full border border-sky-300/60 bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-800 dark:border-sky-500/50 dark:bg-sky-900/30 dark:text-sky-300">
                                                                    Consent
                                                                </span>
                                                            ) : (
                                                                <span />
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </section>

                    <section className="border rounded-lg p-4 bg-card text-card-foreground overflow-x-auto">
                        <h2 className="text-lg font-semibold mb-3">Last 20 Warning Logs</h2>
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
                    </section>
                </>
            )}
        </div>
    );
}
