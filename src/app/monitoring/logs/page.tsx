"use client"
import * as React from "react";

import { BarChart3, RefreshCcw, Terminal } from "lucide-react";
import { toast } from "sonner";

import { Heading } from "@/components/heading";
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
    data_pull_coverage_by_subject: Array<{
        subject_id: string;
        total_pulls: number;
        pulls_with_unique_file_md5: number;
        recent_pull_items: Array<{
            subject_id: string;
            data_source_name: string | null;
            pull_timestamp: string | null;
            has_file_md5: boolean;
        }>;
    }>;
    data_pull_trend_by_subject: Array<{ subject_id: string; day: string; pulls_with_unique_file_md5: number }>;
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
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "N/A";
    return date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "2-digit",
    });
};

const normalizeDataSourceName = (value: string | null | undefined): string => {
    if (!value) return "unknown";
    const firstUnderscore = value.indexOf("_");
    if (firstUnderscore === -1) return value;
    return value.slice(firstUnderscore + 1);
};

export default function MonitoringPage() {
    const monitoringIcon = <Terminal className="h-8 w-8" />;

    const [projectIdInput, setProjectIdInput] = React.useState("Procan");
    const [projectId, setProjectId] = React.useState("Procan");
    const [data, setData] = React.useState<MonitoringResponse | null>(null);
    const [loading, setLoading] = React.useState(true);

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

    const trendBySubject = React.useMemo(() => {
        const grouped = new Map<string, Array<{ day: string; pulls_with_unique_file_md5: number }>>();
        for (const row of data?.data_pull_trend_by_subject ?? []) {
            if (!grouped.has(row.subject_id)) {
                grouped.set(row.subject_id, []);
            }
            grouped.get(row.subject_id)?.push({ day: row.day, pulls_with_unique_file_md5: row.pulls_with_unique_file_md5 });
        }

        for (const entries of grouped.values()) {
            entries.sort((a, b) => b.day.localeCompare(a.day));
        }

        return grouped;
    }, [data]);

    const highestTrendCount = React.useMemo(() => {
        const allValues = (data?.data_pull_trend_by_subject ?? []).map((row) => row.pulls_with_unique_file_md5);
        return allValues.length > 0 ? Math.max(...allValues) : 1;
    }, [data]);

    const coverageSourceColumns = React.useMemo(() => {
        const allSources = new Set<string>();
        for (const subject of data?.data_pull_coverage_by_subject ?? []) {
            for (const item of subject.recent_pull_items) {
                allSources.add(normalizeDataSourceName(item.data_source_name));
            }
        }
        return [...allSources].sort((a, b) => a.localeCompare(b));
    }, [data]);

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
                        <table className="w-full text-sm border-collapse">
                            <thead>
                                <tr className="border-b">
                                    <th className="text-left py-2">Site ID</th>
                                    <th className="text-left py-2">Subject IDs</th>
                                    <th className="text-left py-2">Count</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.summary.subjects_missing_required_variables_by_site.length === 0 ? (
                                    <tr>
                                        <td className="py-2 text-muted-foreground" colSpan={3}>No records</td>
                                    </tr>
                                ) : (
                                    data.summary.subjects_missing_required_variables_by_site.map((row) => (
                                        <tr key={row.site_id} className="border-b">
                                            <td className="py-2">{row.site_id}</td>
                                            <td className="py-2">
                                                {row.subject_ids?.join(", ") || "N/A"}
                                            </td>
                                            <td className="py-2">{row.count}</td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </section>

                    <section className="border rounded-lg p-4 bg-card text-card-foreground overflow-x-auto">
                        <h2 className="text-lg font-semibold mb-3">Data Pull Coverage</h2>
                        {data.metadata?.notes?.data_pulls_available === false && (
                            <p className="text-xs text-muted-foreground mb-3">
                                Data pull metrics are unavailable in this environment because `data_pulls` schema does not contain the required subject mapping columns.
                            </p>
                        )}
                        <table className="w-full text-sm border-collapse">
                            <thead>
                                <tr className="border-b">
                                    <th className="text-left py-2">Subject ID</th>
                                    <th className="text-left py-2">Total Pulls</th>
                                    <th className="text-left py-2">Pulls With Unique file_md5</th>
                                    {coverageSourceColumns.map((source) => (
                                        <th key={source} className="text-left py-2">{source}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {data.data_pull_coverage_by_subject.length === 0 ? (
                                    <tr>
                                        <td className="py-2 text-muted-foreground" colSpan={3 + coverageSourceColumns.length}>No records</td>
                                    </tr>
                                ) : (
                                    data.data_pull_coverage_by_subject.map((row) => (
                                        <tr key={row.subject_id} className="border-b align-top">
                                            <td className="py-2 pr-3">{row.subject_id}</td>
                                            <td className="py-2 pr-3">{row.total_pulls}</td>
                                            <td className="py-2 pr-3">{row.pulls_with_unique_file_md5}</td>
                                            {coverageSourceColumns.map((source) => {
                                                const matchedTimes = row.recent_pull_items
                                                    .filter((item) => normalizeDataSourceName(item.data_source_name) === source)
                                                    .map((item) => item.pull_timestamp)
                                                    .filter((value): value is string => Boolean(value))
                                                    .sort((a, b) => b.localeCompare(a));

                                                return (
                                                    <td key={`${row.subject_id}-${source}`} className="py-2 pr-3">
                                                        {matchedTimes.length === 0
                                                            ? <span className="text-muted-foreground">N/A</span>
                                                            : <span className="text-xs">{matchedTimes.slice(0, 3).map(asLocalDateTime).join(" | ")}</span>}
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </section>

                    <section className="border rounded-lg p-4 bg-card text-card-foreground overflow-x-auto">
                        <h2 className="text-lg font-semibold mb-3">Newly Added Last Night</h2>
                        <table className="w-full text-sm border-collapse">
                            <thead>
                                <tr className="border-b">
                                    <th className="text-left py-2">Subject ID</th>
                                    <th className="text-left py-2">Site ID</th>
                                    <th className="text-left py-2">Created At</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.newly_added_last_night.length === 0 ? (
                                    <tr>
                                        <td className="py-2 text-muted-foreground" colSpan={3}>No records</td>
                                    </tr>
                                ) : (
                                    data.newly_added_last_night.map((row) => (
                                        <tr key={`${row.subject_id}-${row.site_id}`} className="border-b">
                                            <td className="py-2">{row.subject_id}</td>
                                            <td className="py-2">{row.site_id}</td>
                                            <td className="py-2">{asLocalDateTime(row.created_at)}</td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </section>

                    <section className="border rounded-lg p-4 bg-card text-card-foreground">
                        <div className="flex items-center gap-2 mb-3">
                            <BarChart3 className="h-5 w-5" />
                            <h2 className="text-lg font-semibold">Pull Trend (daily, pulls with unique file_md5, newest first)</h2>
                        </div>
                        <div className="space-y-4">
                            {[...trendBySubject.entries()].length === 0 ? (
                                <p className="text-sm text-muted-foreground">No trend data</p>
                            ) : (
                                [...trendBySubject.entries()].map(([subjectId, points]) => (
                                    <div key={subjectId} className="border rounded-md p-3">
                                        <h3 className="text-sm font-semibold mb-2">{subjectId}</h3>
                                        <div className="space-y-2">
                                            {points.map((point) => {
                                                const widthPercent = Math.max(4, (point.pulls_with_unique_file_md5 / highestTrendCount) * 100);
                                                return (
                                                    <div key={`${subjectId}-${point.day}`} className="grid grid-cols-[160px_1fr_60px] gap-2 items-center text-xs">
                                                        <span>{asReadableDate(point.day)}</span>
                                                        <div className="h-3 rounded bg-muted overflow-hidden">
                                                            <div className="h-full bg-emerald-500" style={{ width: `${widthPercent}%` }} />
                                                        </div>
                                                        <span>{point.pulls_with_unique_file_md5}</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </section>

                    <section className="border rounded-lg p-4 bg-card text-card-foreground overflow-x-auto">
                        <h2 className="text-lg font-semibold mb-3">Last 20 Warning Logs</h2>
                        <table className="w-full text-sm border-collapse">
                            <thead>
                                <tr className="border-b">
                                    <th className="text-left py-2">Timestamp</th>
                                    <th className="text-left py-2">Level</th>
                                    <th className="text-left py-2">Message</th>
                                    <th className="text-left py-2">Site</th>
                                    <th className="text-left py-2">Subject</th>
                                    <th className="text-left py-2">Data Source</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.last_warning_logs.length === 0 ? (
                                    <tr>
                                        <td className="py-2 text-muted-foreground" colSpan={6}>No warning logs</td>
                                    </tr>
                                ) : (
                                    data.last_warning_logs.map((row, index) => (
                                        <tr key={`${row.timestamp}-${index}`} className="border-b align-top">
                                            <td className="py-2 pr-3">{asLocalDateTime(row.timestamp)}</td>
                                            <td className="py-2 pr-3">{row.level}</td>
                                            <td className="py-2 pr-3">{row.message || "N/A"}</td>
                                            <td className="py-2 pr-3">{row.site_id || "N/A"}</td>
                                            <td className="py-2 pr-3">{row.subject_id || "N/A"}</td>
                                            <td className="py-2">{row.data_source_name || "N/A"}</td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </section>
                </>
            )}
        </div>
    );
}
