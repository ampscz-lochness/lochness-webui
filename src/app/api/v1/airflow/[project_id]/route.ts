import { Airflow } from "@/lib/models/airflow";
import { AirflowModelError } from "@/types/airflow";

export async function GET(
    _request: Request,
    props: { params: Promise<{ project_id: string }> }
): Promise<Response> {
    const params = await props.params;
    const projectId = params.project_id;

    if (!projectId) {
        return new Response(JSON.stringify({ error: "Missing project_id" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
        });
    }

    try {
        const payload = await Airflow.getProjectDagHealth(projectId);
        return new Response(JSON.stringify(payload), {
            headers: { "Content-Type": "application/json" },
        });
    } catch (error) {
        if (error instanceof AirflowModelError) {
            return new Response(
                JSON.stringify({
                    error: error.message,
                    ...(error.details ?? {}),
                }),
                {
                    status: error.status,
                    headers: { "Content-Type": "application/json" },
                }
            );
        }

        console.error(error);
        return new Response(
            JSON.stringify({ error: "Failed to fetch Airflow DAG health" }),
            {
                status: 500,
                headers: { "Content-Type": "application/json" },
            }
        );
    }
}
