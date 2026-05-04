export type HostInfo = {
    hostname: string;
    platform: string;
    os_type: string;
    os_release: string;
    uptime_seconds: number;
    boot_time: string;
    load_avg_1m: number;
    load_avg_5m: number;
    load_avg_15m: number;
    total_mem_bytes: number;
    free_mem_bytes: number;
};

export type ServerRestartRecord = {
    id: number;
    pg_start_time: string;
    recorded_at: string;
    uptime_seconds: number | null;
};

export type ServerUptimePayload = {
    fetched_at: string;
    host: HostInfo;
    database: {
        current_start_time: string;
        current_uptime_seconds: number;
        restart_history: ServerRestartRecord[];
        total_restarts: number;
        restarts_last_7_days: number;
    };
};

export class ServerUptimeModelError extends Error {
    constructor(
        message: string,
        public readonly status: number,
        public readonly details?: Record<string, unknown>
    ) {
        super(message);
        this.name = "ServerUptimeModelError";
    }
}
