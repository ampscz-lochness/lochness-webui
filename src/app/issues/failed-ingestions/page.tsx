"use client";

import * as React from "react";
import {
    AlertTriangle,
    CheckCircle2,
    ChevronRight,
    Clock,
    ExternalLink,
    RefreshCcw,
    ServerCrash,
    SkipForward,
    Timer,
    Workflow,
    XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { Heading } from "@/components/heading";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
    AirflowDagHealth,
    AirflowDagRun,
    AirflowHealthPayload,
    AirflowRunDetail,
    AirflowTaskState,
} from "@/types/airflow";

const asLocalDateTime = (value: string | null | undefined): string => {
    if (!value) return "N/A";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "N/A";
    return date.toLocaleString();
};

const timeSince = (value: string | null | undefined): string => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";

    const diffMs = Date.now() - date.getTime();
    const diffMins = Math.floor(diffMs / 60_000);

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;

    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;

    return `${Math.floor(diffHours / 24)}d ago`;
};

const formatDuration = (seconds: number | null | undefined): string => {
    if (seconds == null) return "N/A";
    if (seconds < 60) return `${seconds.toFixed(1)}s`;

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    return `${minutes}m ${remainingSeconds}s`;
};

const TASK_STATE_CONFIG: Record<
    string,
    { icon: React.ReactNode; badge: string; label: string }
> = {
    success: {
        icon: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />,
        badge:
            "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
        label: "success",
    },
    failed: {
        icon: <XCircle className="h-3.5 w-3.5 text-red-500" />,
        badge: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
        label: "failed",
    },
    running: {
        icon: <RefreshCcw className="h-3.5 w-3.5 animate-spin text-blue-500" />,
        badge:
            "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
        label: "running",
    },
    queued: {
        icon: <Clock className="h-3.5 w-3.5 text-slate-500" />,
        badge: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
        label: "queued",
    },
    skipped: {
        icon: <SkipForward className="h-3.5 w-3.5 text-slate-400" />,
        badge: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
        label: "skipped",
    },
    upstream_failed: {
        icon: <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />,
        badge:
            "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
        label: "upstream failed",
    },
    restarting: {
        icon: <RefreshCcw className="h-3.5 w-3.5 text-amber-500" />,
        badge:
            "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
        label: "restarting",
    },
};

function taskStateConfig(state: AirflowTaskState) {
    return (
        TASK_STATE_CONFIG[state ?? ""] ?? {
            icon: <Clock className="h-3.5 w-3.5 text-slate-400" />,
            badge: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
            label: state ?? "unknown",
        }
    );
}

function RunDetailSheet({
    dagId,
    dagDisplayName,
    run,
    open,
    onOpenChange,
}: {
    dagId: string;
    dagDisplayName: string;
    run: AirflowDagRun;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const [detail, setDetail] = React.useState<AirflowRunDetail | null>(null);
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [expandedLogs, setExpandedLogs] = React.useState<Set<string>>(new Set());
    const airflowUrl = process.env.NEXT_PUBLIC_AIRFLOW_URL;

    React.useEffect(() => {
        if (!open) return;

        let cancelled = false;
        setDetail(null);
        setError(null);
        setExpandedLogs(new Set());
        setLoading(true);

        fetch(
            `/api/v1/airflow/run-detail?dag_id=${encodeURIComponent(dagId)}&run_id=${encodeURIComponent(run.dag_run_id)}`
        )
            .then(async (response) => {
                if (!response.ok) {
                    const body = await response.json().catch(() => ({}));
                    throw new Error(
                        (body as { error?: string }).error ?? `HTTP ${response.status}`
                    );
                }

                return (await response.json()) as AirflowRunDetail;
            })
            .then((payload) => {
                if (!cancelled) setDetail(payload);
            })
            .catch((fetchError) => {
                if (!cancelled) {
                    setError(
                        fetchError instanceof Error
                            ? fetchError.message
                            : String(fetchError)
                    );
                }
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [dagId, open, run.dag_run_id]);

    const toggleLog = (taskId: string) => {
        setExpandedLogs((prev) => {
            const next = new Set(prev);
            if (next.has(taskId)) next.delete(taskId);
            else next.add(taskId);
            return next;
        });
    };

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
                <SheetHeader className="mb-4">
                    <SheetTitle className="flex items-center gap-2 text-base">
                        <Workflow className="h-4 w-4 shrink-0" />
                        <span className="truncate">{dagDisplayName}</span>
                    </SheetTitle>
                    <p className="break-all font-mono text-xs text-muted-foreground">
                        {run.dag_run_id}
                    </p>
                </SheetHeader>

                <div className="mb-5 grid grid-cols-2 gap-3 text-sm">
                    <div>
                        <p className="mb-0.5 text-xs text-muted-foreground">Started</p>
                        <p>{asLocalDateTime(run.start_date)}</p>
                        <p className="text-xs text-muted-foreground">
                            ({timeSince(run.start_date)})
                        </p>
                    </div>
                    <div>
                        <p className="mb-0.5 text-xs text-muted-foreground">Ended</p>
                        <p>{asLocalDateTime(run.end_date)}</p>
                    </div>
                    {detail && (
                        <>
                            <div>
                                <p className="mb-0.5 text-xs text-muted-foreground">
                                    Duration
                                </p>
                                <p className="flex items-center gap-1">
                                    <Timer className="h-3.5 w-3.5 text-muted-foreground" />
                                    {formatDuration(detail.duration_seconds)}
                                </p>
                            </div>
                            <div>
                                <p className="mb-0.5 text-xs text-muted-foreground">
                                    Run type
                                </p>
                                <p className="capitalize">
                                    {detail.run_type?.replace(/_/g, " ") ?? "-"}
                                </p>
                            </div>
                        </>
                    )}
                </div>

                {airflowUrl && (
                    <a
                        href={`${airflowUrl}/dags/${encodeURIComponent(dagId)}/grid?dag_run_id=${encodeURIComponent(run.dag_run_id)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mb-5 inline-flex items-center gap-1.5 text-xs text-blue-600 hover:underline dark:text-blue-400"
                    >
                        <ExternalLink className="h-3 w-3" />
                        Open run in Airflow
                    </a>
                )}

                <hr className="mb-4" />

                {loading && (
                    <div className="space-y-2">
                        {[0, 1, 2, 3].map((item) => (
                            <Skeleton key={item} className="h-10 w-full rounded" />
                        ))}
                    </div>
                )}

                {!loading && error && (
                    <div className="rounded-lg border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
                        {error}
                    </div>
                )}

                {!loading && detail && (
                    <div className="space-y-2">
                        <p className="mb-3 text-sm font-semibold">
                            Tasks ({detail.task_instances.length})
                        </p>

                        {detail.task_instances.map((task) => {
                            const stateConfig = taskStateConfig(task.state);
                            const isLogOpen = expandedLogs.has(task.task_id);

                            return (
                                <div
                                    key={task.task_id}
                                    className="overflow-hidden rounded-lg border bg-card"
                                >
                                    <div className="flex items-center gap-2 px-3 py-2.5">
                                        {stateConfig.icon}
                                        <span
                                            className="flex-1 truncate text-sm font-medium"
                                            title={task.task_id}
                                        >
                                            {task.task_display_name}
                                        </span>
                                        <span
                                            className={`rounded-full px-1.5 py-0.5 text-xs font-medium ${stateConfig.badge}`}
                                        >
                                            {stateConfig.label}
                                        </span>
                                        <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                                            {formatDuration(task.duration)}
                                        </span>

                                        {task.max_tries > 0 && (
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <span className="shrink-0 text-xs text-muted-foreground">
                                                        try {task.try_number}/{task.max_tries + 1}
                                                    </span>
                                                </TooltipTrigger>
                                                <TooltipContent>
                                                    Attempt {task.try_number} of {task.max_tries + 1}
                                                </TooltipContent>
                                            </Tooltip>
                                        )}

                                        {task.log_snippet && task.log_snippet.length > 0 && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-6 shrink-0 px-1.5"
                                                onClick={() => toggleLog(task.task_id)}
                                            >
                                                <ChevronRight
                                                    className={`h-3.5 w-3.5 transition-transform ${isLogOpen ? "rotate-90" : ""}`}
                                                />
                                            </Button>
                                        )}
                                    </div>

                                    {isLogOpen && task.log_snippet && (
                                        <div className="max-h-72 overflow-y-auto border-t bg-slate-950 px-3 py-2">
                                            <pre className="whitespace-pre-wrap break-all text-[10px] leading-4 text-slate-300">
                                                {task.log_snippet.join("\n")}
                                            </pre>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </SheetContent>
        </Sheet>
    );
}

function SummaryCard({
    icon,
    label,
    value,
    colorClass,
    active = false,
    onClick,
}: {
    icon: React.ReactNode;
    label: string;
    value: React.ReactNode;
    colorClass: string;
    active?: boolean;
    onClick?: () => void;
}) {
    const Component = onClick ? "button" : "div";

    return (
        <Component
            type={onClick ? "button" : undefined}
            onClick={onClick}
            className={`flex w-full items-center gap-4 rounded-lg border bg-card p-4 text-left shadow-sm transition-colors ${
                onClick ? "hover:bg-accent/40" : ""
            } ${active ? "ring-2 ring-primary/40" : ""}`}
        >
            <div className={`rounded-full p-2 ${colorClass}`}>{icon}</div>
            <div>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-2xl font-semibold leading-tight">{value}</p>
            </div>
        </Component>
    );
}

function runStateBadgeClass(state: string | null) {
    switch (state) {
        case "failed":
            return "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300";
        case "success":
            return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300";
        case "running":
            return "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300";
        case "queued":
            return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
        default:
            return "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400";
    }
}

function DagOverviewRow({ dag }: { dag: AirflowDagHealth }) {
    const airflowUrl = process.env.NEXT_PUBLIC_AIRFLOW_URL;

    return (
        <div className="rounded-lg border bg-card p-3 shadow-sm">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium" title={dag.dag_id}>
                            {dag.dag_display_name}
                        </span>
                        {dag.is_paused && (
                            <Badge variant="outline" className="shrink-0 text-xs">
                                paused
                            </Badge>
                        )}
                        <span
                            className={`rounded-full px-1.5 py-0.5 text-xs font-medium ${runStateBadgeClass(
                                dag.last_run_state
                            )}`}
                        >
                            {dag.last_run_state ?? "no recent run"}
                        </span>
                    </div>
                    <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                        {dag.dag_id}
                    </p>
                </div>

                {airflowUrl && (
                    <a
                        href={`${airflowUrl}/dags/${encodeURIComponent(dag.dag_id)}/grid`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 text-xs text-blue-600 hover:underline dark:text-blue-400"
                    >
                        Airflow ↗
                    </a>
                )}
            </div>

            <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span>Last run: {asLocalDateTime(dag.last_run_start)}</span>
                <span>Failures 24h: {dag.failure_count_24h}</span>
                <span>Successes 24h: {dag.success_count_24h}</span>
            </div>
        </div>
    );
}

function DagFailureRow({ dag }: { dag: AirflowDagHealth }) {
    const [selectedRun, setSelectedRun] = React.useState<AirflowDagRun | null>(null);
    const airflowUrl = process.env.NEXT_PUBLIC_AIRFLOW_URL;
    const latestFailedRun = dag.latest_failed_runs[0] ?? null;

    const openLatestFailedRun = () => {
        if (latestFailedRun) setSelectedRun(latestFailedRun);
    };

    return (
        <>
            <div
                role={latestFailedRun ? "button" : undefined}
                tabIndex={latestFailedRun ? 0 : undefined}
                onClick={openLatestFailedRun}
                onKeyDown={(event) => {
                    if (!latestFailedRun) return;
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openLatestFailedRun();
                    }
                }}
                className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900/40 dark:bg-red-950/20"
            >
                <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                        <XCircle className="h-4 w-4 shrink-0 text-red-500" />
                        <span className="truncate text-sm font-medium" title={dag.dag_id}>
                            {dag.dag_display_name}
                        </span>
                        {dag.is_paused && (
                            <Badge variant="outline" className="shrink-0 text-xs">
                                paused
                            </Badge>
                        )}
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Badge variant="destructive" className="cursor-default text-xs">
                                    {dag.failure_count_24h} failed in 24h
                                </Badge>
                            </TooltipTrigger>
                            <TooltipContent>
                                Failed DAG runs in the last 24 hours
                            </TooltipContent>
                        </Tooltip>

                        {airflowUrl && (
                            <a
                                href={`${airflowUrl}/dags/${encodeURIComponent(dag.dag_id)}/grid`}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(event) => event.stopPropagation()}
                                className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                            >
                                Airflow ↗
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

                {latestFailedRun && (
                    <p className="mt-1 text-xs text-muted-foreground">
                        Click the card to inspect the latest failed run.
                    </p>
                )}

                {dag.latest_failed_runs.length > 0 && (
                    <div className="mt-3 space-y-1.5">
                        <p className="mb-1 text-xs font-medium text-muted-foreground">
                            Failed runs - click to inspect:
                        </p>

                        {dag.latest_failed_runs.map((run) => (
                            <button
                                key={run.dag_run_id}
                                type="button"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    setSelectedRun(run);
                                }}
                                className="group w-full rounded border border-red-200 bg-white px-3 py-1.5 text-left text-xs transition-colors hover:bg-red-50 dark:border-red-900/30 dark:bg-red-950/30 dark:hover:bg-red-900/40"
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <span className="max-w-[300px] truncate font-mono text-muted-foreground">
                                        {run.dag_run_id}
                                    </span>
                                    <div className="flex shrink-0 items-center gap-2">
                                        <span className="text-muted-foreground">
                                            {asLocalDateTime(run.start_date)}{" "}
                                            <span className="opacity-60">
                                                ({timeSince(run.start_date)})
                                            </span>
                                        </span>
                                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground transition-colors group-hover:text-foreground" />
                                    </div>
                                </div>

                                {run.note && (
                                    <p className="mt-0.5 truncate text-red-700 dark:text-red-400">
                                        {run.note}
                                    </p>
                                )}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {selectedRun && (
                <RunDetailSheet
                    dagId={dag.dag_id}
                    dagDisplayName={dag.dag_display_name}
                    run={selectedRun}
                    open={selectedRun !== null}
                    onOpenChange={(isOpen) => {
                        if (!isOpen) setSelectedRun(null);
                    }}
                />
            )}
        </>
    );
}

function PageSkeleton() {
    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {[0, 1, 2, 3].map((item) => (
                    <Skeleton key={item} className="h-20 w-full rounded-lg" />
                ))}
            </div>
            {[0, 1, 2].map((item) => (
                <Skeleton key={item} className="h-16 w-full rounded-lg" />
            ))}
        </div>
    );
}

export default function FailedIngestionsPage() {
    const [selectedSummary, setSelectedSummary] = React.useState<
        "all" | "failing" | "failures" | "healthy"
    >("failing");
    const [projectIdInput, setProjectIdInput] = React.useState("Procan");
    const [projectId, setProjectId] = React.useState("Procan");
    const [data, setData] = React.useState<AirflowHealthPayload | null>(null);
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    const fetchHealth = React.useCallback(async (currentProjectId: string) => {
        setLoading(true);
        setError(null);
        setData(null);

        try {
            const response = await fetch(
                `/api/v1/airflow/${encodeURIComponent(currentProjectId)}`
            );

            if (!response.ok) {
                const body = await response.json().catch(() => ({}));
                throw new Error(
                    (body as { error?: string }).error ?? `HTTP ${response.status}`
                );
            }

            setData((await response.json()) as AirflowHealthPayload);
        } catch (fetchError) {
            const message =
                fetchError instanceof Error ? fetchError.message : "Unknown error";
            setError(message);
            toast.error(`Failed to load Airflow health: ${message}`);
        } finally {
            setLoading(false);
        }
    }, []);

    React.useEffect(() => {
        void fetchHealth(projectId);
    }, [fetchHealth, projectId]);

    const failingDags = (data?.dags ?? []).filter(
        (dag) => dag.failure_count_24h > 0
    );
    const healthyDags = (data?.dags ?? []).filter(
        (dag) => dag.failure_count_24h === 0 && dag.success_count_24h > 0
    );
    const visibleDags =
        selectedSummary === "all"
            ? data?.dags ?? []
            : selectedSummary === "healthy"
              ? healthyDags
              : failingDags;
    const selectedSummaryMeta =
        selectedSummary === "all"
            ? {
                  title: "All DAGs",
                  tone: "default" as const,
                  description: "Every DAG included in the current Airflow project snapshot.",
              }
            : selectedSummary === "healthy"
              ? {
                    title: "Healthy DAGs in the last 24 hours",
                    tone: "healthy" as const,
                    description: "DAGs with successful recent runs and no failures in the last 24 hours.",
                }
              : selectedSummary === "failures"
                ? {
                      title: "Failure details in the last 24 hours",
                      tone: "failure" as const,
                      description: "DAGs contributing to the total failed runs count in the last 24 hours.",
                  }
                : {
                      title: "DAGs failing in the last 24 hours",
                      tone: "failure" as const,
                      description: "DAGs with at least one failed run in the last 24 hours.",
                  };

    return (
        <div className="container mx-auto max-w-5xl p-6">
            <Heading
                icon={<Workflow className="h-8 w-8" />}
                title="Failed Data Ingestions"
            />

            <div className="mb-6 flex flex-wrap items-center gap-2">
                <Input
                    className="w-48"
                    placeholder="Project ID"
                    value={projectIdInput}
                    onChange={(event) => setProjectIdInput(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === "Enter" && projectIdInput.trim()) {
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
                    onClick={() => {
                        void fetchHealth(projectId);
                    }}
                    title="Refresh"
                >
                    <RefreshCcw
                        className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
                    />
                </Button>
                {data && (
                    <span className="ml-1 text-xs text-muted-foreground">
                        Fetched: {asLocalDateTime(data.fetched_at)}
                    </span>
                )}
            </div>

            {loading && <PageSkeleton />}

            {!loading && error && (
                <div className="flex items-start gap-3 rounded-lg border border-destructive bg-destructive/10 p-4">
                    <ServerCrash className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
                    <div>
                        <p className="font-semibold text-destructive">
                            Could not reach Airflow
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">{error}</p>
                    </div>
                </div>
            )}

            {!loading && data && (
                <div className="space-y-6">
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                        <SummaryCard
                            icon={
                                <Workflow className="h-5 w-5 text-slate-600 dark:text-slate-300" />
                            }
                            label="Total DAGs"
                            value={data.summary.total_dags}
                            colorClass="bg-slate-100 dark:bg-slate-800"
                            active={selectedSummary === "all"}
                            onClick={() => setSelectedSummary("all")}
                        />
                        <SummaryCard
                            icon={<XCircle className="h-5 w-5 text-red-600" />}
                            label="DAGs failing (24h)"
                            value={data.summary.dags_with_failures_24h}
                            colorClass="bg-red-100 dark:bg-red-900/30"
                            active={selectedSummary === "failing"}
                            onClick={() => setSelectedSummary("failing")}
                        />
                        <SummaryCard
                            icon={<AlertTriangle className="h-5 w-5 text-amber-600" />}
                            label="Total failures (24h)"
                            value={data.summary.total_failures_24h}
                            colorClass="bg-amber-100 dark:bg-amber-900/30"
                            active={selectedSummary === "failures"}
                            onClick={() => setSelectedSummary("failures")}
                        />
                        <SummaryCard
                            icon={<CheckCircle2 className="h-5 w-5 text-emerald-600" />}
                            label="DAGs healthy (24h)"
                            value={data.summary.dags_healthy_24h}
                            colorClass="bg-emerald-100 dark:bg-emerald-900/30"
                            active={selectedSummary === "healthy"}
                            onClick={() => setSelectedSummary("healthy")}
                        />
                    </div>

                    {visibleDags.length > 0 ? (
                        <div className="space-y-3">
                            <h2 className="flex items-center gap-2 text-lg font-semibold">
                                {selectedSummaryMeta.tone === "healthy" ? (
                                    <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                                ) : selectedSummaryMeta.tone === "failure" ? (
                                    <XCircle className="h-5 w-5 text-red-500" />
                                ) : (
                                    <Workflow className="h-5 w-5 text-slate-500" />
                                )}
                                {selectedSummaryMeta.title}
                                <Badge
                                    variant={
                                        selectedSummaryMeta.tone === "failure"
                                            ? "destructive"
                                            : "secondary"
                                    }
                                    className="ml-1"
                                >
                                    {visibleDags.length}
                                </Badge>
                            </h2>
                            <p className="text-sm text-muted-foreground">
                                {selectedSummaryMeta.description}
                            </p>

                            {visibleDags.map((dag) => (
                                dag.failure_count_24h > 0 ? (
                                    <DagFailureRow key={dag.dag_id} dag={dag} />
                                ) : (
                                    <DagOverviewRow key={dag.dag_id} dag={dag} />
                                )
                            ))}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 py-12 dark:border-emerald-800/40 dark:bg-emerald-950/20">
                            <CheckCircle2 className="h-12 w-12 text-emerald-500" />
                            <p className="text-lg font-semibold text-emerald-700 dark:text-emerald-400">
                                No DAGs in this selection
                            </p>
                            <p className="text-sm text-muted-foreground">
                                {selectedSummary === "healthy"
                                    ? "No DAGs had successful recent runs without failures in the last 24 hours."
                                    : selectedSummary === "all"
                                      ? "No DAGs were returned for this Airflow project snapshot."
                                      : "No DAGs in this project recorded failures in the last 24 hours."}
                            </p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
