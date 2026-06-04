import { DayTracker, DayTrackerModelError } from "@/lib/models/daytracker";

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
        const response = await DayTracker.getProjectDayTracker(projectId);
        return new Response(JSON.stringify(response), {
            headers: { "Content-Type": "application/json" },
        });
    } catch (error) {
        if (error instanceof DayTrackerModelError) {
            return new Response(
                JSON.stringify({ error: error.message, ...(error.details ?? {}) }),
                { status: error.status, headers: { "Content-Type": "application/json" } }
            );
        }
        console.error(error);
        return new Response(JSON.stringify({ error: "Failed to fetch day tracker data" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
}
