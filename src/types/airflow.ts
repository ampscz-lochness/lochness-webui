export type AirflowDagRunState = "success" | "failed" | "running" | "queued";

export type AirflowDagRun = {
    dag_run_id: string;
    dag_id: string;
    logical_date: string | null;
    start_date: string | null;
    end_date: string | null;
    state: AirflowDagRunState;
    note: string | null;
};

export type AirflowDagHealth = {
    dag_id: string;
    dag_display_name: string;
    is_paused: boolean;
    last_run_state: AirflowDagRunState | null;
    last_run_start: string | null;
    failure_count_24h: number;
    success_count_24h: number;
    latest_failed_runs: AirflowDagRun[];
};

export type AirflowHealthPayload = {
    project_id: string;
    fetched_at: string;
    summary: {
        total_dags: number;
        dags_with_failures_24h: number;
        dags_healthy_24h: number;
        total_failures_24h: number;
    };
    dags: AirflowDagHealth[];
};

export class AirflowModelError extends Error {
    constructor(
        message: string,
        public readonly status: number,
        public readonly details?: Record<string, unknown>
    ) {
        super(message);
        this.name = "AirflowModelError";
    }
}
