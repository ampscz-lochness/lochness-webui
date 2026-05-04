import { ServerUptime } from "@/lib/models/server-uptime";
import { ServerUptimeModelError } from "@/types/server-uptime";

export async function GET(): Promise<Response> {
    try {
        const payload = await ServerUptime.getUptimePayload();
        return new Response(JSON.stringify(payload), {
            headers: { "Content-Type": "application/json" },
        });
    } catch (error) {
        if (error instanceof ServerUptimeModelError) {
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
            JSON.stringify({ error: "Failed to fetch server uptime data" }),
            {
                status: 500,
                headers: { "Content-Type": "application/json" },
            }
        );
    }
}
