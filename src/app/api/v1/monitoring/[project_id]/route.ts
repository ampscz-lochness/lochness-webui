import { Monitoring, MonitoringModelError } from "@/lib/models/monitoring";

export async function GET(
    request: Request,
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
        const response = await Monitoring.getProjectMonitoring(projectId);
        return new Response(JSON.stringify(response), {
            headers: {
                "Content-Type": "application/json",
            },
        });
    } catch (error) {
        if (error instanceof MonitoringModelError) {
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
        return new Response(JSON.stringify({ error: "Failed to fetch monitoring data" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
}
