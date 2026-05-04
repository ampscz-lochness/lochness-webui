"use client";
import * as React from "react";
import { ServerCrash, RefreshCcw } from "lucide-react";
import { toast } from "sonner";

import { Heading } from "@/components/heading";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import type { ServerUptimePayload, ServerRestartRecord } from "@/types/server-uptime";

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatUptime(seconds: number): { days: number; hours: number; minutes: number; label: string } {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const parts: string[] = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    parts.push(`${minutes}m`);
    return { days, hours, minutes, label: parts.join(" ") };
}

function formatDateTime(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    });
}

function formatDuration(seconds: number | null): string {
    if (seconds == null) return "—";
    return formatUptime(seconds).label || "< 1m";
}

function isWithin7Days(isoDate: string, fetchedAt: string): boolean {
    const sevenDaysAgo = new Date(new Date(fetchedAt).getTime() - 7 * 24 * 60 * 60 * 1000);
    return new Date(isoDate) >= sevenDaysAgo;
}

// ── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
    label,
    value,
    sub,
    accent,
}: {
    label: string;
    value: React.ReactNode;
    sub?: React.ReactNode;
    accent?: string;
}) {
    return (
        <div
            className={`rounded-lg border border-l-4 p-5 bg-white dark:bg-slate-800 shadow-sm ${accent ?? "border-l-violet-500"}`}
        >
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                {label}
            </p>
            <p className="text-3xl font-bold text-gray-800 dark:text-white">{value}</p>
            {sub && <p className="text-sm text-muted-foreground mt-1">{sub}</p>}
        </div>
    );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function ServerUptimePage() {
    const [payload, setPayload] = React.useState<ServerUptimePayload | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);

    const fetchData = React.useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetch("/api/v1/server-uptime");
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error ?? `HTTP ${res.status}`);
            }
            const data: ServerUptimePayload = await res.json();
            setPayload(data);
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Unknown error";
            setError(msg);
            toast.error("Failed to load server uptime", { description: msg });
        } finally {
            setLoading(false);
        }
    }, []);

    React.useEffect(() => {
        fetchData();
    }, [fetchData]);

    const uptime = React.useMemo(
        () => (payload ? formatUptime(payload.database.current_uptime_seconds) : null),
        [payload]
    );

    const hostUptime = React.useMemo(
        () => (payload ? formatUptime(payload.host.uptime_seconds) : null),
        [payload]
    );

    const recentReboots = React.useMemo(
        () =>
            payload
                ? payload.database.restart_history.filter((r) =>
                      isWithin7Days(r.pg_start_time, payload.fetched_at)
                  )
                : [],
        [payload]
    );

    return (
        <div className="container mx-auto p-6 max-w-5xl">
            {/* Header */}
            <div className="flex items-center justify-between mb-2">
                <Heading title="Server Uptime" icon={<ServerCrash className="w-7 h-7 text-violet-500" />} />
                <Button
                    variant="outline"
                    size="sm"
                    onClick={fetchData}
                    disabled={loading}
                    className="flex items-center gap-2"
                >
                    <RefreshCcw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                    Refresh
                </Button>
            </div>

            {/* Status badge */}
            {payload && (
                <div className="flex items-center gap-3 mb-6">
                    <Badge className="bg-emerald-500 hover:bg-emerald-500 text-white px-3 py-1 text-sm">
                        🟢 Online
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                        Host <span className="font-medium text-gray-700 dark:text-gray-300">{payload.host.hostname}</span>
                        {" · "}
                        PostgreSQL running since{" "}
                        <span className="font-medium text-gray-700 dark:text-gray-300">
                            {formatDateTime(payload.database.current_start_time)}
                        </span>
                    </span>
                </div>
            )}

            {loading && !payload && (
                <p className="text-muted-foreground mb-6">Loading uptime data…</p>
            )}
            {error && (
                <div className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-900/20 p-4 mb-6 text-red-700 dark:text-red-400">
                    {error}
                </div>
            )}

            {payload && uptime && hostUptime && (
                <>
                    {/* ── Host Machine ── */}
                    <h2 className="text-lg font-semibold text-gray-800 dark:text-white mb-3">
                        Host Machine
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                        <StatCard
                            label="Host Uptime"
                            value={hostUptime.label}
                            sub={`Since ${formatDateTime(payload.host.boot_time)}`}
                            accent="border-l-indigo-500"
                        />
                        <StatCard
                            label="Load Average"
                            value={
                                <span className="text-2xl">
                                    {payload.host.load_avg_1m.toFixed(2)}
                                </span>
                            }
                            sub={`1 min · 5 min: ${payload.host.load_avg_5m.toFixed(2)} · 15 min: ${payload.host.load_avg_15m.toFixed(2)}`}
                            accent="border-l-indigo-500"
                        />
                        <StatCard
                            label="Memory"
                            value={`${Math.round((1 - payload.host.free_mem_bytes / payload.host.total_mem_bytes) * 100)}%`}
                            sub={`${(payload.host.free_mem_bytes / 1073741824).toFixed(1)} GB free of ${(payload.host.total_mem_bytes / 1073741824).toFixed(1)} GB`}
                            accent="border-l-indigo-500"
                        />
                    </div>
                    <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-5 py-4 mb-8 text-sm grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div>
                            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Hostname</p>
                            <p className="font-medium text-gray-800 dark:text-gray-200">{payload.host.hostname}</p>
                        </div>
                        <div>
                            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">Platform</p>
                            <p className="font-medium text-gray-800 dark:text-gray-200">{payload.host.platform}</p>
                        </div>
                        <div>
                            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">OS Type</p>
                            <p className="font-medium text-gray-800 dark:text-gray-200">{payload.host.os_type}</p>
                        </div>
                        <div>
                            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-0.5">OS Release</p>
                            <p className="font-medium text-gray-800 dark:text-gray-200">{payload.host.os_release}</p>
                        </div>
                    </div>

                    <Separator className="mb-6" />

                    {/* ── PostgreSQL Database ── */}
                    <h2 className="text-lg font-semibold text-gray-800 dark:text-white mb-3">
                        PostgreSQL Database
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
                        <StatCard
                            label="Time Since Last Reboot"
                            value={uptime.label}
                            sub={`${uptime.days} day${uptime.days !== 1 ? "s" : ""} ${uptime.hours}h ${uptime.minutes}m`}
                            accent="border-l-violet-500"
                        />
                        <StatCard
                            label="Total Reboots Recorded"
                            value={payload.database.total_restarts}
                            sub="All-time restart records"
                            accent="border-l-sky-500"
                        />
                        <StatCard
                            label="Reboots in Last 7 Days"
                            value={
                                <span
                                    className={
                                        payload.database.restarts_last_7_days > 0
                                            ? "text-amber-600 dark:text-amber-400"
                                            : "text-emerald-600 dark:text-emerald-400"
                                    }
                                >
                                    {payload.database.restarts_last_7_days}
                                </span>
                            }
                            sub={
                                payload.database.restarts_last_7_days > 0
                                    ? "⚠ Recent restarts detected"
                                    : "✓ No recent restarts"
                            }
                            accent={
                                payload.database.restarts_last_7_days > 0
                                    ? "border-l-amber-500"
                                    : "border-l-emerald-500"
                            }
                        />
                    </div>

                    <Separator className="mb-6" />

                    {/* Restart History */}
                    <h2 className="text-lg font-semibold text-gray-800 dark:text-white mb-3">
                        DB Restart History
                    </h2>

                    {payload.database.restart_history.length === 0 ? (
                        <p className="text-muted-foreground text-sm">No restart records found.</p>
                    ) : (
                        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="bg-gray-50 dark:bg-slate-700/60 text-left">
                                        <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-300 w-10">
                                            #
                                        </th>
                                        <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">
                                            Restart Time
                                        </th>
                                        <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <span className="cursor-default underline decoration-dotted">
                                                        Session Duration
                                                    </span>
                                                </TooltipTrigger>
                                                <TooltipContent className="max-w-xs">
                                                    How long this server session ran before the next restart was detected. The current session shows ongoing uptime. This is historical data — there are no scheduled restarts.
                                                </TooltipContent>
                                            </Tooltip>
                                        </th>
                                        <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">
                                            Recorded At
                                        </th>
                                        <th className="px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">
                                            Status
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {payload.database.restart_history.map(
                                        (record: ServerRestartRecord, idx: number) => {
                                            const recent = isWithin7Days(
                                                record.pg_start_time,
                                                payload.fetched_at
                                            );
                                            const isCurrent =
                                                record.pg_start_time === payload.database.current_start_time;
                                            return (
                                                <tr
                                                    key={record.id}
                                                    className={[
                                                        idx % 2 === 0
                                                            ? "bg-white dark:bg-slate-800"
                                                            : "bg-gray-50 dark:bg-slate-800/60",
                                                        recent
                                                            ? "border-l-4 border-l-amber-400 bg-amber-50/60 dark:bg-amber-900/10"
                                                            : "",
                                                    ]
                                                        .filter(Boolean)
                                                        .join(" ")}
                                                >
                                                    <td className="px-4 py-3 text-muted-foreground">
                                                        {record.id}
                                                    </td>
                                                    <td className="px-4 py-3 font-medium text-gray-800 dark:text-gray-200">
                                                        {formatDateTime(record.pg_start_time)}
                                                        {recent && (
                                                            <Tooltip>
                                                                <TooltipTrigger asChild>
                                                                    <span className="ml-2 inline-block cursor-default">
                                                                        <Badge
                                                                            variant="outline"
                                                                            className="text-amber-600 border-amber-400 text-xs"
                                                                        >
                                                                            Last 7 days
                                                                        </Badge>
                                                                    </span>
                                                                </TooltipTrigger>
                                                                <TooltipContent>
                                                                    This restart occurred within the past 7 days
                                                                </TooltipContent>
                                                            </Tooltip>
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300">
                                                        {isCurrent ? (
                                                            <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                                                                {uptime.label}{" "}
                                                                <span className="text-xs text-muted-foreground font-normal">
                                                                    (current, ongoing)
                                                                </span>
                                                            </span>
                                                        ) : (
                                                            formatDuration(record.uptime_seconds)
                                                        )}
                                                    </td>
                                                    <td className="px-4 py-3 text-muted-foreground text-xs">
                                                        {formatDateTime(record.recorded_at)}
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        {isCurrent ? (
                                                            <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border-0">
                                                                Current
                                                            </Badge>
                                                        ) : (
                                                            <Badge
                                                                variant="outline"
                                                                className="text-muted-foreground text-xs"
                                                            >
                                                                Historical
                                                            </Badge>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        }
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {recentReboots.length > 0 && (
                        <p className="text-xs text-muted-foreground mt-3">
                            ⚠ Rows highlighted in amber indicate restarts within the last 7 days.
                        </p>
                    )}

                    <p className="text-xs text-muted-foreground mt-4">
                        Uptime data sourced from{" "}
                        <code className="font-mono bg-gray-100 dark:bg-slate-700 px-1 py-0.5 rounded text-xs">
                            pg_postmaster_start_time()
                        </code>
                        . Last fetched: {formatDateTime(payload.fetched_at)}.
                    </p>
                </>
            )}
        </div>
    );
}
