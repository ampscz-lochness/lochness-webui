"use client"
import React from "react";
import { ChevronLeft } from "lucide-react"
import Link from 'next/link'
import Image from 'next/image';
import { useRouter, usePathname } from 'next/navigation';
import { toast } from "sonner";

import { Button } from "@/components/ui/button"

import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Skeleton } from "@/components/ui/skeleton"

import { Pencil } from "lucide-react"

import { DataSource } from "@/types/data-sources";

type Params = Promise<{ project_id: string, site_id: string, instance_name: string }>;

export default function ShowRedcapDataSource({
    params,
}: {
    params: Params
}) {
    const [projectId, setProjectId] = React.useState<string | null>(null);
    const [siteId, setSiteId] = React.useState<string | null>(null);
    const [instanceName, setInstanceName] = React.useState<string | null>(null);

    const [dataSource, setDataSource] = React.useState<DataSource | null>(null);

    const router = useRouter();
    const pathname = usePathname();

    React.useEffect(() => {
        const getProjectId = async () => {
            const { project_id } = await params;
            setProjectId(decodeURIComponent(project_id))
        };

        const getSiteId = async () => {
            const { site_id } = await params;
            setSiteId(decodeURIComponent(site_id));
        };

        const getInstanceName = async () => {
            const { instance_name } = await params;
            setInstanceName(decodeURIComponent(instance_name));
        };

        getProjectId();
        getSiteId();
        getInstanceName();
    }, [params]);

    React.useEffect(() => {
        const fetchDataSource = async () => {
            if (projectId && siteId && instanceName) {
                const response = await fetch(`/api/v1/projects/${projectId}/sites/${siteId}/sources/${instanceName}`);

                if (!response.ok) {
                    // Check status code and handle errors accordingly
                    if (response.status === 401) {
                        // Handle unauthorized access
                        toast.message("Unauthorized access", {
                            duration: 5000,
                            description: "Please log in to access this page.",
                            action: {
                                label: "Login",
                                onClick: () => {
                                    router.push(`/auth/login?afterLogin=${pathname}`);
                                },
                            },
                        });
                    }
                } else {
                    const data = await response.json();
                    setDataSource(data);
                }
            }
        };

        fetchDataSource();
    }, [projectId, siteId, instanceName, router, pathname]);

    return (
        <>
            {/* Header */}
            <div className="p-4 md:p-4 border-b">
                <div className="max-w-screen-xl mx-auto">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center">
                            <Button
                                variant="ghost"
                                asChild
                                size="sm"
                                className="mr-2"
                            >
                                <Link href={`/config/projects/${projectId}/sites/${siteId}`} className="flex items-center">
                                    <ChevronLeft />
                                </Link>
                            </Button>

                            <Breadcrumb>
                                <BreadcrumbList>
                                    <BreadcrumbItem>
                                        {projectId ? (
                                            <BreadcrumbLink
                                                href={`/config/projects/${projectId}`}
                                            >
                                                {projectId}
                                            </BreadcrumbLink>
                                        ) : (
                                            <Skeleton className="h-4 w-[150px] bg-gray-200 dark:bg-gray-700" />
                                        )}
                                    </BreadcrumbItem>
                                    <BreadcrumbSeparator />
                                    <BreadcrumbItem>
                                        {(projectId && siteId) ? (
                                            <BreadcrumbLink
                                                href={`/config/projects/${projectId}/sites/${siteId}`}
                                            >
                                                {siteId}
                                            </BreadcrumbLink>
                                        ) : (
                                            <Skeleton className="h-4 w-[150px] bg-gray-200 dark:bg-gray-700" />
                                        )}
                                    </BreadcrumbItem>
                                    <BreadcrumbSeparator />
                                    <BreadcrumbItem>
                                        <BreadcrumbLink>
                                            Data Sources
                                        </BreadcrumbLink>
                                    </BreadcrumbItem>
                                    <BreadcrumbSeparator />
                                    <BreadcrumbItem>
                                        {instanceName ? (
                                            <BreadcrumbLink>
                                                {instanceName}
                                            </BreadcrumbLink>
                                        ) : (
                                            <Skeleton className="h-4 w-[150px] bg-gray-200 dark:bg-gray-700" />
                                        )}
                                    </BreadcrumbItem>
                                </BreadcrumbList>
                            </Breadcrumb>
                        </div>

                        <div className="flex items-center gap-2">

                        </div>
                    </div>
                </div>
            </div>

            {/* Data Source Details */}
            <div className="container mx-auto p-6 max-w-5xl flex flex-col">
                <div className="space-y-6">
                    <div className="overflow-hidden border rounded-lg">
                        {dataSource ? (
                            <>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    {/* Image and Name Section */}
                                    <div className="p-4 border-b md:border-b-0 md:border-r flex items-center gap-4 col-span-1 md:col-span-2">
                                        {/* Conditionally render image based on type */}
                                        {dataSource.data_source_type === 'redcap' && (
                                            <Image src="/logo/redcap.jpeg" alt="REDCap" width={48} height={48} className="rounded" />
                                        )}
                                        {/* Add other conditions for different types if needed */}
                                        {/* <Image src={getDataSourceLogo(dataSource.data_source_type)} alt={`${dataSource.data_source_type} logo`} width={48} height={48} /> */}
                                        <div>
                                            <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">Data Source Name</p>
                                            <p className="mt-1 font-medium">{dataSource.data_source_name}</p>
                                            <p className="text-xs text-gray-400 dark:text-gray-500 uppe">Type: <span className="uppercase">{dataSource.data_source_type}</span></p>
                                        </div>
                                    </div>
                                    {/* Status Section */}
                                    <div className="p-4 col-span-1">
                                        <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">Status</p>
                                        <p className={`mt-1 font-medium ${dataSource.data_source_is_active ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                            {dataSource.data_source_is_active ? 'Active' : 'Inactive'}
                                        </p>
                                    </div>
                                </div>
                                {/* Metadata Section */}
                                <div className="p-4 border-t">
                                    <div className="flex justify-between items-center mb-2">
                                        <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">Configuration Details</p>
                                        {/* Edit Button */}
                                        {(projectId && siteId && instanceName) && (
                                            <Button variant="outline" size="sm" asChild>
                                                <Link href={`/config/projects/${projectId}/sites/${siteId}/data-sources/redcap/${instanceName}/edit`}>
                                                    <Pencil className="h-4 w-4" />
                                                    <span>Edit</span>
                                                </Link>
                                            </Button>
                                        )}
                                    </div>
                                    <pre className="mt-2 text-xs bg-gray-100 dark:bg-gray-800 p-2 rounded overflow-x-auto">
                                        {JSON.stringify(dataSource.data_source_metadata, null, 2) || "No configuration details"}
                                    </pre>
                                </div>
                            </>
                        ) : (
                            // Skeleton Loader
                            <>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    {/* Skeleton for Image and Name */}
                                    <div className="p-4 border-b md:border-b-0 md:border-r flex items-center gap-4 col-span-1 md:col-span-2">
                                        <Skeleton className="h-12 w-12 rounded bg-gray-200 dark:bg-gray-700" />
                                        <div className="space-y-2">
                                            <Skeleton className="h-4 w-24 bg-gray-200 dark:bg-gray-700" />
                                            <Skeleton className="h-6 w-40 bg-gray-200 dark:bg-gray-700" />
                                            <Skeleton className="h-3 w-20 bg-gray-200 dark:bg-gray-700" />
                                        </div>
                                    </div>
                                    {/* Skeleton for Status */}
                                    <div className="p-4 col-span-1">
                                        <Skeleton className="h-4 w-16 mb-2 bg-gray-200 dark:bg-gray-700" />
                                        <Skeleton className="h-6 w-20 bg-gray-200 dark:bg-gray-700" />
                                    </div>
                                </div>
                                {/* Skeleton for Metadata */}
                                <div className="p-4 border-t">
                                    <div className="flex justify-between items-center mb-2">
                                        <Skeleton className="h-4 w-32 bg-gray-200 dark:bg-gray-700" />
                                        <Skeleton className="h-8 w-16 bg-gray-200 dark:bg-gray-700" /> {/* Skeleton for Edit button */}
                                    </div>
                                    <Skeleton className="h-20 w-full bg-gray-200 dark:bg-gray-700" />
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </>
    )

}