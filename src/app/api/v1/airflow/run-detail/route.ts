import { Airflow } from "@/lib/models/airflow";
import { AirflowModelError } from "@/types/airflow";

export async function GET(request: Request): Promise<Response> {
    const { searchParams } = new URL(request.url);
    const dagId = searchParams.get("dag_id");
    const runId = searchParams.get("run_id");

    if (!dagId || !runId) {
        return new Response(JSON.stringify({ error: "Missing dag_id or run_id" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
        });
    }

    try {
        const payload = await Airflow.getRunDetail(dagId, runId);
        return new Response(JSON.stringify(payload), {
            headers: { "Content-Type": "application/json" },
        });
    } catch (error) {
        if (error instanceof AirflowModelError) {
            return new Response(
                JSON.stringify({ error: error.message, ...(error.details ?? {}) }),
                { status: error.status, headers: { "Content-Type": "application/json" } }
            );
        }
        console.error(error);
        return new Response(JSON.stringify({ error: "Failed to fetch run detail" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
}
