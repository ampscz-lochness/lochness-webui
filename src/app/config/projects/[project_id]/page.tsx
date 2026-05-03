"use client"
import { formatDistance } from 'date-fns';
import Link from 'next/link';
import * as React from 'react';
import { toast } from "sonner";

import { Activity, ChevronLeft, Pencil, Plus } from "lucide-react";

import { SkeletonCard } from '@/components/placeholders/card';
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton"

import { Project } from '@/types/projects';

// import SitesListPlaceholder from "@/components/placeholders/config/sites"
import SitesList from '@/components/lists/sites';

type Params = Promise<{ project_id: string }>

export default function ProjectPage({
    params,
}: {
    params: Params
}) {
    const [projectId, setProjectId] = React.useState<string | null>(null);
    const [project, setProject] = React.useState<Project | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [created_at, setCreatedAt] = React.useState<string | null>(null);
    const [createdAtDistance, setCreatedAtDistance] = React.useState<string | null>(null);


    React.useEffect(() => {
        const getProjectId = async () => {
            const { project_id } = await params;
            setProjectId(project_id);
        };
        getProjectId();
    }, [params]);

    React.useEffect(() => {
        const fetchProject = async () => {
            if (projectId) {
                try {
                    const response = await fetch(`/api/v1/projects/${projectId}`);
                    if (!response.ok) {
                        throw new Error('Failed to fetch project');
                    }
                    const data = await response.json();
                    setProject(data);

                    setCreatedAt(new Date(data.project_metadata.created_at).toLocaleDateString());
                    setCreatedAtDistance(formatDistance(new Date(data.project_metadata.created_at), new Date(), { addSuffix: true }));
                } catch (error) {
                    console.error(error);
                    toast.error('Failed to fetch project');
                } finally {
                    setLoading(false);
                }
            }
        }

        fetchProject();
    }, [projectId]);

    return (
        <>
            {loading ? (
                <>
                    {/* Skeleton for Header */}
                    <div className="p-4 md:p-4 border-b">
                        <div className="max-w-screen-xl mx-auto">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center space-x-4">
                                    {/* Back Button Skeleton */}
                                    <Skeleton className="h-10 w-10 rounded hidden sm:flex bg-gray-200 dark:bg-gray-700" />
                                    <div>
                                        {/* Title Skeleton */}
                                        <Skeleton className="h-7 w-48 mb-1 bg-gray-200 dark:bg-gray-700" />
                                        {/* Project ID Skeleton */}
                                        <Skeleton className="h-3 w-32 bg-gray-200 dark:bg-gray-700" />
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    {/* Edit Button Skeleton */}
                                    <Skeleton className="h-9 w-20 rounded bg-gray-200 dark:bg-gray-700" />
                                    {/* Active/Inactive Button Skeleton */}
                                    <Skeleton className="h-9 w-24 rounded bg-gray-200 dark:bg-gray-700" />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Skeleton for Main Content */}
                    <div className="container mx-auto p-6 max-w-5xl flex flex-col h-full">
                        <div className="grid gap-6">
                            {/* Metadata Skeleton */}
                            <div className="grid gap-4">
                                <div>
                                    <Skeleton className="h-4 w-16 mb-2 bg-gray-200 dark:bg-gray-700" /> {/* Created Label */}
                                    <Skeleton className="h-4 w-40 bg-gray-200 dark:bg-gray-700" /> {/* Created Date */}
                                </div>
                                <div>
                                    <Skeleton className="h-4 w-24 mb-2 bg-gray-200 dark:bg-gray-700" /> {/* Description Label */}
                                    <Skeleton className="h-4 w-full mb-1 bg-gray-200 dark:bg-gray-700" /> {/* Description Line 1 */}
                                    <Skeleton className="h-4 w-3/4 bg-gray-200 dark:bg-gray-700" />      {/* Description Line 2 */}
                                </div>
                            </div>

                            {/* Sites Section Skeleton */}
                            <div className="mt-6">
                                <div className="flex justify-between items-center mb-4">
                                    <div>
                                        <Skeleton className="h-6 w-16 mb-2 bg-gray-200 dark:bg-gray-700" /> {/* Sites Title */}
                                        <Skeleton className="h-4 w-64 bg-gray-200 dark:bg-gray-700" />      {/* Sites Description */}
                                    </div>
                                    {/* Add Site Button Skeleton */}
                                    <Skeleton className="h-9 w-28 rounded bg-gray-200 dark:bg-gray-700" />
                                </div>
                                {/* Placeholder for Sites List */}
                                <div className="flex space-x-4 mt-4">
                                    <SkeletonCard />
                                    <SkeletonCard />
                                    <SkeletonCard />
                                </div>
                            </div>
                        </div>
                    </div>
                </>
            ) : project ? (
                <>
                    <div className="p-4 md:p-4 border-b">
                        <div className="max-w-screen-xl mx-auto">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center space-x-4">
                                    <Button
                                        variant="ghost"
                                        size="lg"
                                        asChild
                                        className="mr-2 hidden sm:flex"
                                    >
                                        <Link href="/config/projects" className="flex items-center">
                                            <ChevronLeft />
                                        </Link>
                                    </Button>
                                    <div>
                                        <h2 className="text-2xl font-medium">{project.project_name || 'Untitled Project'}</h2>
                                        <p className="text-xs text-gray-500">Project ID: {projectId}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Button asChild variant="outline" size="sm" className="flex items-center gap-2">
                                        <Link href={`/config/projects/${projectId}/edit`} className="flex items-center gap-2">
                                            <Pencil className="h-4 w-4" />
                                            <span className="hidden sm:inline">Edit</span>
                                        </Link>
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant={project.project_is_active ? "outline" : "secondary"}
                                        className="flex items-center gap-2"
                                    >
                                        <div className="flex items-center gap-2">
                                            <Activity className="h-4 w-4" />
                                            <span className="hidden sm:inline">
                                                {project.project_is_active ? 'Active' : 'Inactive'}
                                            </span>
                                            <div className={`h-2 w-2 rounded-full ${project.project_is_active ? 'bg-green-500' : 'bg-gray-400'}`}></div>
                                        </div>
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="container mx-auto p-6 max-w-5xl flex flex-col h-full">
                        <div className="grid gap-4">
                            <div>
                                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Created</h3>
                                <p className="text-sm text-gray-600 dark:text-gray-400">
                                    {created_at} {createdAtDistance && <span className="text-xs text-gray-400 dark:text-gray-500">({createdAtDistance})</span>}
                                </p>
                            </div>
                            <div>
                                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Description</h3>
                                <p className="text-sm text-gray-600 dark:text-gray-400">{project.project_metadata.description || 'No description available'}</p>
                            </div>
                        </div>

                        <div className="mt-6">
                            <div className="flex justify-between items-center mb-2">
                                <div>
                                    <h2 className="text-xl font-semibold text-gray-700 dark:text-gray-300">Sites</h2>
                                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Manage the sites for this project.</p>
                                </div>
                                <Button asChild size="sm" className="flex items-center gap-2">
                                    <Link href={`/config/projects/${projectId}/sites/new`} className="flex items-center gap-2">
                                        <Plus className="h-4 w-4" />
                                        <span className="hidden sm:inline">Add Site</span>
                                    </Link>
                                </Button>
                            </div>
                            <div className="mt-4">
                                {projectId && <SitesList project_id={projectId} />}
                            </div>
                        </div>
                    </div>
                </>
            ) : (
                <div className="container mx-auto p-6 max-w-5xl flex flex-col items-center justify-center h-full">
                    <div className="text-center p-10 border border-dashed border-gray-300 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800/50 w-full max-w-md">
                        <h2 className='text-6xl font-bold text-gray-800 dark:text-gray-200 mb-4'>
                            404
                        </h2>
                        <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-2">
                            Project Not Found
                        </h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
                            We could not find a project with the ID <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded text-xs font-mono">{projectId}</code>.
                        </p>
                        <div className="flex flex-col sm:flex-row justify-center gap-2">
                            <Button asChild variant="default" size="sm">
                                <Link href="/config/projects/new" className="flex items-center gap-2">
                                    <Plus className="h-4 w-4" />
                                    Create New Project
                                </Link>
                            </Button>
                            <Button asChild variant="outline" size="sm">
                                <Link href="/config/projects" className="flex items-center gap-2">
                                    View All Projects
                                </Link>
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}