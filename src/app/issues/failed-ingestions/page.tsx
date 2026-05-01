"use client";
import * as React from "react";
import {
    AlertTriangle,
    CheckCircle2,
    RefreshCcw,
    ServerCrash,
    Workflow,
    XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { Heading } from "@/components/heading";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import type { AirflowDagHealth, AirflowHealthPayload } from "@/types/airflow";

// ── Helpers ───────────────────────────────────────────────────────────────────

const asLocalDateTime = (value: string | null | undefined): string => {
    if (!value) return "N/A";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "N/A";
    return d.toLocaleString();
};

const timeSince = (value: string | null | undefined): string => {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    const diffMs = Date.now() - d.getTime();
    const diffMins = Math.floor(diffMs / 60_000);
    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHrs = Math.floor(diffMins / 60);
    if (diffHrs < 24) return `${diffHrs}h ago`;
    return `${Math.floor(diffHrs / 24)}d ago`;
};

// ── Summary card ─────────────────────────────────────────────────────────────

function SummaryCard({
    icon,
    label,
    value,
    colorClass,
}: {
    icon: React.ReactNode;
    label: string;
    value: React.ReactNode;
    colorClass: string;
}) {
    return (
        <div className="flex items-center gap-4 rounded-lg border bg-card p-4 shadow-sm">
            <div className={`rounded-full p-2 ${colorClass}`}>{icon}</div>
            <div>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-2xl font-semibold leading-tight">{value}</p>
            </div>
        </div>
    );
}

// ── DAG failure row ───────────────────────────────────────────────────────────

function DagFailureRow({ dag }: { dag: AirflowDagHealth }) {
    const [expanded, setExpanded] = React.useState(false);
    const airflowUrl = process.env.NEXT_PUBLIC_AIRFLOW_URL;

    return (
        <div className="rounded-lg border border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/20 p-3">
            <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                    <XCircle className="h-4 w-4 shrink-0 text-red-500" />
                    <span className="font-mono text-sm font-medium truncate" title={dag.dag_id}>{dag.dag_display_name}</span>
                    {dag.is_paused && (
                        <Badge variant="outline" className="text-xs shrink-0">
                            paused
                        </Badge>
                    )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Badge
                                variant="destructive"
                                className="cursor-default text-xs"
                            >
                                {dag.failure_count_24h} failed in 24h
                            </Badge>
                        </TooltipTrigger>
                        <TooltipContent>
                            Failed DAG runs in the last 24 hours
                        </TooltipContent>
                    </Tooltip>
                    {dag.latest_failed_runs.length > 0 && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs"
                            onClick={() => setExpanded((v) => !v)}
                        >
                            {expanded ? "Hide runs" : "Show runs"}
                        </Button>
                    )}
                    {airflowUrl && (
                        <a
                            href={`${airflowUrl}/dags/${encodeURIComponent(dag.dag_id)}/grid`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                        >
                            Open in Airflow ↗
                        </a>
                    )}
                </div>
            </div>

            <p className="mt-1 text-xs text-muted-foreground">
                Last run: {asLocalDateTime(dag.last_run_start)}{" "}
                <span className="text-red-600 dark:text-red-400">
                    ({dag.last_run_state ?? "unknown"})
                </span>
            </p>

            {expanded && dag.latest_failed_runs.length > 0 && (
                <div className="mt-3 space-y-1.5">
                    {dag.latest_failed_runs.map((run) => (
                        <div
                            key={run.dag_run_id}
                            className="rounded border border-red-200 bg-white dark:border-red-900/30 dark:bg-red-950/30 px-3 py-1.5 text-xs"
                        >
                            <div className="flex items-center justify-between gap-2">
                                <span className="font-mono text-muted-foreground truncate max-w-[260px]">
                                    {run.dag_run_id}
                                </span>
                                <span className="text-muted-foreground shrink-0">
                                    {asLocalDateTime(run.start_date)}{" "}
                                    <span className="opacity-60">
                                        ({timeSince(run.start_date)})
                                    </span>
                                </span>
                            </div>
                            {run.note && (
                                <p className="mt-0.5 text-red-700 dark:text-red-400 truncate">
                                    {run.note}
                                </p>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ── Skeleton loader ───────────────────────────────────────────────────────────

function PageSkeleton() {
    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {[0, 1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-20 w-full rounded-lg" />
                ))}
            </div>
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
        </div>
    );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function FailedIngestionsPage() {
    const [projectIdInput, setProjectIdInput] = React.useState("Procan");
    const [projectId, setProjectId] = React.useState("Procan");
    const [data, setData] = React.useState<AirflowHealthPayload | null>(null);
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    const fetchHealth = React.useCallback(async (pid: string) => {
        setLoading(true);
        setError(null);
        setData(null);
        try {
            const res = await fetch(
                `/api/v1/airflow/${encodeURIComponent(pid)}`
            );
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(
                    (body as { error?: string }).error ??
                        `HTTP ${res.status}`
                );
            }
            const json = (await res.json()) as AirflowHealthPayload;
            setData(json);
        } catch (err) {
            const msg =
                err instanceof Error ? err.message : "Unknown error";
            setError(msg);
            toast.error(`Failed to load Airflow health: ${msg}`);
        } finally {
            setLoading(false);
        }
    }, []);

    React.useEffect(() => {
        fetchHealth(projectId);
    }, [projectId, fetchHealth]);

    const failingDags = (data?.dags ?? []).filter((d) => d.failure_count_24h > 0);
    const hasFailures = failingDags.length > 0;

    return (
        <div className="container mx-auto p-6 max-w-5xl">
            <Heading
                icon={<Workflow className="h-8 w-8" />}
                title="Failed Data Ingestions"
            />

            {/* ── Project selector ── */}
            <div className="mb-6 flex items-center gap-2 flex-wrap">
                <Input
                    className="w-48"
                    placeholder="Project ID"
                    value={projectIdInput}
                    onChange={(e) => setProjectIdInput(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && projectIdInput.trim()) {
                            setProjectId(projectIdInput.trim());
                        }
                    }}
                />
                <Button
                    onClick={() => setProjectId(projectIdInput.trim())}
                    disabled={!projectIdInput.trim() || loading}
                >
                    Load
                </Button>
                <Button
                    variant="outline"
                    size="icon"
                    disabled={loading}
                    onClick={() => fetchHealth(projectId)}
                    title="Refresh"
                >
                    <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                </Button>
                {data && (
                    <span className="text-xs text-muted-foreground ml-1">
                        Fetched: {asLocalDateTime(data.fetched_at)}
                    </span>
                )}
            </div>

            {/* ── Loading ── */}
            {loading && <PageSkeleton />}

            {/* ── Error ── */}
            {!loading && error && (
                <div className="flex items-start gap-3 rounded-lg border border-destructive bg-destructive/10 p-4">
                    <ServerCrash className="h-5 w-5 mt-0.5 shrink-0 text-destructive" />
                    <div>
                        <p className="font-semibold text-destructive">
                            Could not reach Airflow
                        </p>
                        <p className="text-sm text-muted-foreground mt-1">{error}</p>
                    </div>
                </div>
            )}

            {/* ── Results ── */}
            {!loading && data && (
                <div className="space-y-6">
                    {/* Summary cards */}
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                        <SummaryCard
                            icon={<Workflow className="h-5 w-5 text-slate-600 dark:text-slate-300" />}
                            label="Total DAGs"
                            value={data.summary.total_dags}
                            colorClass="bg-slate-100 dark:bg-slate-800"
                        />
                        <SummaryCard
                            icon={<XCircle className="h-5 w-5 text-red-600" />}
                            label="DAGs failing (24h)"
                            value={data.summary.dags_with_failures_24h}
                            colorClass="bg-red-100 dark:bg-red-900/30"
                        />
                        <SummaryCard
                            icon={<AlertTriangle className="h-5 w-5 text-amber-600" />}
                            label="Total failures (24h)"
                            value={data.summary.total_failures_24h}
                            colorClass="bg-amber-100 dark:bg-amber-900/30"
                        />
                        <SummaryCard
                            icon={<CheckCircle2 className="h-5 w-5 text-emerald-600" />}
                            label="DAGs healthy (24h)"
                            value={data.summary.dags_healthy_24h}
                            colorClass="bg-emerald-100 dark:bg-emerald-900/30"
                        />
                    </div>

                    {/* Failure list or healthy state */}
                    {hasFailures ? (
                        <div className="space-y-3">
                            <h2 className="text-lg font-semibold flex items-center gap-2">
                                <XCircle className="h-5 w-5 text-red-500" />
                                DAGs with failures in the last 24 hours
                                <Badge variant="destructive" className="ml-1">
                                    {failingDags.length}
                                </Badge>
                            </h2>
                            {failingDags.map((dag) => (
                                <DagFailureRow key={dag.dag_id} dag={dag} />
                            ))}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 dark:border-emerald-800/40 dark:bg-emerald-950/20 py-12">
                            <CheckCircle2 className="h-12 w-12 text-emerald-500" />
                            <p className="text-lg font-semibold text-emerald-700 dark:text-emerald-400">
                                No failures in the last 24 hours
                            </p>
                            <p className="text-sm text-muted-foreground">
                                All {data.summary.total_dags} DAGs ran successfully or have no recent runs.
                            </p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
