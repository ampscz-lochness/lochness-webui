import os from "os";
import { getConnection } from "@/lib/db";
import { ServerUptimePayload, ServerUptimeModelError } from "@/types/server-uptime";

type PgStartTimeRow = {
    start_time: Date;
    now: Date;
};

type RestartLogRow = {
    id: number;
    pg_start_time: Date;
    recorded_at: Date;
    uptime_seconds: string | null;
};

export class ServerUptime {
    private static async ensureTable(): Promise<void> {
        const db = getConnection();
        await db.query(`
            CREATE TABLE IF NOT EXISTS public.server_restart_log (
                id          SERIAL PRIMARY KEY,
                pg_start_time TIMESTAMPTZ NOT NULL,
                recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT server_restart_log_pg_start_time_key UNIQUE (pg_start_time)
            )
        `);
    }

    static async getUptimePayload(): Promise<ServerUptimePayload> {
        try {
            const db = getConnection();

            await ServerUptime.ensureTable();

            // Get current pg start time and server clock in one query
            const { rows: timeRows } = await db.query<PgStartTimeRow>(
                `SELECT pg_postmaster_start_time() AS start_time, NOW() AS now`
            );
            const currentStartTime: Date = timeRows[0].start_time;
            const nowTime: Date = timeRows[0].now;
            const currentUptimeSeconds = (nowTime.getTime() - currentStartTime.getTime()) / 1000;

            // Record this start time if not already present (idempotent)
            await db.query(
                `INSERT INTO public.server_restart_log (pg_start_time)
                 VALUES ($1)
                 ON CONFLICT (pg_start_time) DO NOTHING`,
                [currentStartTime]
            );

            // Fetch full history with uptime_seconds = seconds until the next recorded restart (or null for current)
            const { rows: historyRows } = await db.query<RestartLogRow>(`
                SELECT
                    id,
                    pg_start_time,
                    recorded_at,
                    EXTRACT(EPOCH FROM (
                        LEAD(pg_start_time) OVER (ORDER BY pg_start_time) - pg_start_time
                    )) AS uptime_seconds
                FROM public.server_restart_log
                ORDER BY pg_start_time DESC
            `);

            const sevenDaysAgo = new Date(nowTime.getTime() - 7 * 24 * 60 * 60 * 1000);

            const restartHistory = historyRows.map((row) => ({
                id: row.id,
                pg_start_time: row.pg_start_time.toISOString(),
                recorded_at: row.recorded_at.toISOString(),
                uptime_seconds: row.uptime_seconds != null ? parseFloat(row.uptime_seconds) : null,
            }));

            const restartLast7Days = restartHistory.filter(
                (r) => new Date(r.pg_start_time) >= sevenDaysAgo
            ).length;

            // Host machine info via Node.js os module
            const hostUptimeSeconds = os.uptime();
            const bootTime = new Date(Date.now() - hostUptimeSeconds * 1000);
            const [load1, load5, load15] = os.loadavg();

            return {
                fetched_at: nowTime.toISOString(),
                host: {
                    hostname: os.hostname(),
                    platform: os.platform(),
                    os_type: os.type(),
                    os_release: os.release(),
                    uptime_seconds: hostUptimeSeconds,
                    boot_time: bootTime.toISOString(),
                    load_avg_1m: load1,
                    load_avg_5m: load5,
                    load_avg_15m: load15,
                    total_mem_bytes: os.totalmem(),
                    free_mem_bytes: os.freemem(),
                },
                database: {
                    current_start_time: currentStartTime.toISOString(),
                    current_uptime_seconds: currentUptimeSeconds,
                    restart_history: restartHistory,
                    total_restarts: restartHistory.length,
                    restarts_last_7_days: restartLast7Days,
                },
            };
        } catch (error) {
            if (error instanceof ServerUptimeModelError) throw error;
            console.error("[ServerUptime] Failed to fetch uptime payload:", error);
            throw new ServerUptimeModelError(
                "Failed to fetch server uptime data",
                500,
                { cause: String(error) }
            );
        }
    }
}
