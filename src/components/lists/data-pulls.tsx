"use client"
import * as React from "react";
import { formatDistance } from "date-fns";
import { toast } from "sonner";

import EmptyBox from "@/components/placeholders/empty";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type DataPullEvent = {
    id: string;
    log_level: string;
    log_timestamp: string;
    message: string;
    route: string | null;
    data_source_name: string | null;
    status_code: number | null;
};

type DataPullsApiResponse = {
    metadata: {
        totalRows: number;
        limit: number;
        offset: number;
    };
    rows: DataPullEvent[];
};

interface DataPullsListProps {
    project_id: string;
    site_id: string;
}

const badgeVariantFromLevel = (level: string): "default" | "secondary" | "destructive" | "outline" => {
    const normalized = level.toUpperCase();
    if (normalized === "ERROR" || normalized === "CRITICAL") return "destructive";
    if (normalized === "WARNING") return "secondary";
    return "outline";
};

export default function DataPullsList({ project_id, site_id }: DataPullsListProps) {
    const [events, setEvents] = React.useState<DataPullEvent[]>([]);
    const [loading, setLoading] = React.useState(true);

    React.useEffect(() => {
        const fetchDataPulls = async () => {
            try {
                const response = await fetch(`/api/v1/projects/${project_id}/sites/${site_id}/pulls?limit=20&offset=0`);
                if (!response.ok) {
                    throw new Error("Failed to fetch data pulls");
                }

                const data: DataPullsApiResponse = await response.json();
                setEvents(data.rows || []);
            } catch (error) {
                console.error(error);
                toast.error("Failed to fetch recent data pulls");
            } finally {
                setLoading(false);
            }
        };

        fetchDataPulls();
    }, [project_id, site_id]);

    if (loading) {
        return <EmptyBox message="Loading recent data pulls..." />;
    }

    if (!events.length) {
        return <EmptyBox message="No recent data pulls found for this site." />;
    }

    return (
        <div className="space-y-3">
            {events.map((event) => {
                const eventDate = new Date(event.log_timestamp);
                const hasValidDate = !Number.isNaN(eventDate.getTime());

                return (
                    <Card key={event.id} className="py-4">
                        <CardHeader className="px-4 pb-2">
                            <div className="flex items-center justify-between gap-2">
                                <CardTitle className="text-sm font-semibold">
                                    {event.data_source_name || "Data Pull"}
                                </CardTitle>
                                <Badge variant={badgeVariantFromLevel(event.log_level)}>{event.log_level}</Badge>
                            </div>
                        </CardHeader>
                        <CardContent className="px-4 space-y-1">
                            <p className="text-sm">{event.message}</p>
                            {event.route && <p className="text-xs text-muted-foreground">Route: {event.route}</p>}
                            <p className="text-xs text-muted-foreground">
                                {hasValidDate
                                    ? `${eventDate.toLocaleString()} (${formatDistance(eventDate, new Date(), { addSuffix: true })})`
                                    : "Unknown timestamp"}
                            </p>
                            {event.status_code !== null && (
                                <p className="text-xs text-muted-foreground">Status: {event.status_code}</p>
                            )}
                        </CardContent>
                    </Card>
                );
            })}
        </div>
    );
}
