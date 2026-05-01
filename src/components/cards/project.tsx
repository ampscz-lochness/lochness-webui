import { formatDistance } from 'date-fns'
import Link from "next/link"

import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"

import { Project } from "@/types/projects"

export type ProjectCardProps = {
    project: Project
}

export default function ProjectCard({ project }: ProjectCardProps) {
    const { project_id, project_name, project_is_active, project_metadata } = project

    const description = project_metadata.description || null

    const created_at = project_metadata.created_at
        ? new Date(project_metadata.created_at).toISOString()
        : null;
    const formattedCreatedAt = created_at
        ? new Date(created_at).toLocaleDateString()
        : null;

    const createdAtDistance = created_at
        ? formatDistance(new Date(created_at), new Date(), { addSuffix: true })
        : null;

    return (
        <Link href={`/config/projects/${project_id}`} className="w-full">
            <Card className="aspect-square bg-white dark:bg-slate-800/70 shadow-sm border border-gray-200 dark:border-emerald-900/30 transition-all hover:shadow-md hover:border-emerald-200 dark:hover:border-emerald-800">
                <CardHeader className="pb-1">
                    <div className="flex items-center gap-2">
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <CardTitle className="text-xl font-medium truncate">{project_name}</CardTitle>
                            </TooltipTrigger>
                            <TooltipContent>{project_name}</TooltipContent>
                        </Tooltip>
                        <div className={`h-2 w-2 rounded-full ${project_is_active ? 'bg-green-500' : 'bg-gray-400'}`}></div>
                        {/* {project_is_active && Boolean(project_is_active) === true && (
                        <div className="h-2 w-2 rounded-full bg-emerald-500" title="Active project"></div>
                    )} */}
                    </div>
                    <CardDescription className="text-sm text-muted-foreground">
                        Project ID: {project_id}
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
