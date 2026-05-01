import * as React from "react"
import { formatDistance } from 'date-fns'
import Link from 'next/link'

import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"

import { Site } from "@/types/sites"

export type SiteCardProps = {
    site: Site
}

export default function SiteCard({ site }: SiteCardProps) {
    const { site_id, project_id, site_name, site_is_active, site_metadata } = site

    const description = site_metadata.description || null

    const created_at = site_metadata.created_at
        ? new Date(site_metadata.created_at).toISOString()
        : null;
    const formattedCreatedAt = created_at
        ? new Date(created_at).toLocaleDateString()
        : null;

    const createdAtDistance = created_at
        ? formatDistance(new Date(created_at), new Date(), { addSuffix: true })
        : null;

    return (
        <Link href={`/config/projects/${project_id}/sites/${site_id}`} className="w-full">
        <Card className="aspect-square bg-white dark:bg-slate-800/70 shadow-sm border border-gray-200 dark:border-purple-900/30 transition-all hover:shadow-md hover:border-purple-200 dark:hover:border-purple-800">
            <CardHeader className="pb-1">
                <div className="flex items-center gap-2">
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <CardTitle className="text-xl font-medium truncate">{site_name}</CardTitle>
                        </TooltipTrigger>
                        <TooltipContent>{site_name}</TooltipContent>
                    </Tooltip>
                    {site_is_active && Boolean(site_is_active) === true && (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className="h-2 w-2 rounded-full bg-purple-500"></div>
                            </TooltipTrigger>
                            <TooltipContent>Active site</TooltipContent>
                        </Tooltip>
                    )}
                </div>
                <CardDescription className="text-sm text-muted-foreground">
                    Site ID: {site_id}
                </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col justify-center flex-1 space-y-3">
                <div>
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">Description</Label>
                    {description ? (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <p className="mt-1 text-sm truncate overflow-hidden text-ellipsis">
                                    {description}
                                </p>
                            </TooltipTrigger>
                            <TooltipContent>{description}</TooltipContent>
                        </Tooltip>
                    ) : (
                        <p className="mt-1 text-sm text-muted-foreground">No description</p>
                    )}
                </div>
                {created_at && (
                    <div>
                        <Label className="text-xs uppercase tracking-wide text-muted-foreground">Created At</Label>
                        <p className="mt-1 text-sm truncate overflow-hidden text-ellipsis">{formattedCreatedAt} ({createdAtDistance})</p>
                    </div>
                )}
            </CardContent>
        </Card>
        </Link>
    )
}