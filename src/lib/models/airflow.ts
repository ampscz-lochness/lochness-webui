import {
    AirflowDagHealth,
    AirflowDagRun,
    AirflowDagRunState,
    AirflowHealthPayload,
    AirflowModelError,
} from "@/types/airflow";

const AIRFLOW_TIMEOUT_MS = 15_000;

function getAirflowBaseUrl(): string {
    const url = process.env.NEXT_PUBLIC_AIRFLOW_URL;
    if (!url) throw new AirflowModelError("NEXT_PUBLIC_AIRFLOW_URL is not configured", 500);
    return url.replace(/\/$/, "");
}

/** Airflow 3.x uses token-based auth (POST /auth/token → Bearer JWT). */
async function getAirflowBearerToken(signal: AbortSignal): Promise<string> {
    const base = getAirflowBaseUrl();
    const username = process.env.AIRFLOW_USERNAME;
    const password = process.env.AIRFLOW_PASSWORD;
    if (!username || !password) {
        throw new AirflowModelError("Airflow credentials are not configured", 500);
    }

    const res = await fetch(`${base}/auth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
        signal,
    });

    if (!res.ok) {
        throw new AirflowModelError("Airflow authentication failed", 502, {
            airflow_status: res.status,
        });
    }

    const json = (await res.json()) as { access_token?: string };
    if (!json.access_token) {
        throw new AirflowModelError("Airflow token response missing access_token", 502);
    }
    return json.access_token;
}

async function airflowFetch(
    path: string,
    token: string,
    signal: AbortSignal
): Promise<Response> {
    const base = getAirflowBaseUrl();
    return fetch(`${base}${path}`, {
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        signal,
    });
}

function iso24hAgo(): string {
    return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

type RawDag = {
    dag_id: string;
    dag_display_name: string;
    is_paused: boolean;
};

type RawDagRun = {
    dag_run_id: string;
    dag_id: string;
    logical_date: string | null;
    start_date: string | null;
    end_date: string | null;
    state: string;
    note: string | null;
};

export class Airflow {
    static async getProjectDagHealth(projectId: string): Promise<AirflowHealthPayload> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), AIRFLOW_TIMEOUT_MS);

        try {
            const token = await getAirflowBearerToken(controller.signal);

            // Fetch all active DAGs (Airflow 3 uses /api/v2/)
            const dagsRes = await airflowFetch(
                "/api/v2/dags?limit=200",
                token,
                controller.signal
            );

            if (!dagsRes.ok) {
                throw new AirflowModelError("Failed to fetch DAG list from Airflow", 502, {
                    airflow_status: dagsRes.status,
                });
            }

            const dagsJson = (await dagsRes.json()) as { dags: RawDag[] };
            const allDags: RawDag[] = dagsJson.dags ?? [];

            const since = iso24hAgo();

            // Fetch recent runs for all DAGs in parallel (last 50 runs, ordered newest first)
            const runResults = await Promise.allSettled(
                allDags.map(async (dag) => {
                    const runsRes = await airflowFetch(
                        `/api/v2/dags/${encodeURIComponent(dag.dag_id)}/dagRuns` +
                            `?limit=50&order_by=-start_date`,
                        token,
                        controller.signal
                    );
                    if (!runsRes.ok) return { dag_id: dag.dag_id, runs: [] as RawDagRun[] };
                    const json = (await runsRes.json()) as { dag_runs: RawDagRun[] };
                    return { dag_id: dag.dag_id, runs: json.dag_runs ?? [] };
                })
            );

            const dagHealthList: AirflowDagHealth[] = allDags.map((dag, i) => {
                const result = runResults[i];
                const runs: RawDagRun[] =
                    result.status === "fulfilled" ? result.value.runs : [];

                // Most recent run across all time
                const latestRun = runs[0] ?? null;

                // Filter to last 24h
                const runs24h = runs.filter((r) => {
                    const ts = r.start_date ?? r.logical_date;
                    return ts !== null && ts >= since;
                });

                const failedRuns24h = runs24h.filter((r) => r.state === "failed");
                const successRuns24h = runs24h.filter((r) => r.state === "success");

                const latestFailedRuns: AirflowDagRun[] = failedRuns24h
                    .slice(0, 5)
                    .map((r) => ({
                        dag_run_id: r.dag_run_id,
                        dag_id: r.dag_id,
                        logical_date: r.logical_date ?? null,
                        start_date: r.start_date,
                        end_date: r.end_date,
                        state: r.state as AirflowDagRunState,
                        note: r.note ?? null,
                    }));

                return {
                    dag_id: dag.dag_id,
                    dag_display_name: dag.dag_display_name || dag.dag_id,
                    is_paused: dag.is_paused ?? false,
                    last_run_state: latestRun
                        ? (latestRun.state as AirflowDagRunState)
                        : null,
                    last_run_start: latestRun?.start_date ?? null,
                    failure_count_24h: failedRuns24h.length,
                    success_count_24h: successRuns24h.length,
                    latest_failed_runs: latestFailedRuns,
                };
            });

            const dagsWithFailures = dagHealthList.filter((d) => d.failure_count_24h > 0);
            const totalFailures = dagHealthList.reduce((sum, d) => sum + d.failure_count_24h, 0);
            const dagsHealthy = dagHealthList.filter(
                (d) => d.failure_count_24h === 0 && d.success_count_24h > 0
            ).length;

            return {
                project_id: projectId,
                fetched_at: new Date().toISOString(),
                summary: {
                    total_dags: allDags.length,
                    dags_with_failures_24h: dagsWithFailures.length,
                    dags_healthy_24h: dagsHealthy,
                    total_failures_24h: totalFailures,
                },
                dags: dagHealthList,
            };
        } catch (error) {
            if (error instanceof AirflowModelError) throw error;

            if (error instanceof Error && error.name === "AbortError") {
                throw new AirflowModelError("Airflow request timed out", 504);
            }

            throw new AirflowModelError("Unexpected error while querying Airflow", 500, {
                message: error instanceof Error ? error.message : String(error),
            });
        } finally {
            clearTimeout(timer);
        }
    }
}
