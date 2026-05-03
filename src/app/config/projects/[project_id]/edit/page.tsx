"use client"
import * as React from 'react';
import { Heading } from '@/components/heading'

import { Pencil } from "lucide-react"

import ProjectForm from "@/components/forms/project"
import useProtectPage from "@/hooks/protectPage"

type Params = Promise<{ project_id: string }>

export default function EditProjectPage({
    params,
}: {
    params: Params
}) {
    useProtectPage();
    const [projectId, setProjectId] = React.useState<string | null>(null);

    React.useEffect(() => {
        const getProjectId = async () => {
            const { project_id } = await params;
            setProjectId(project_id);
        };
        getProjectId();
    }, [params]);

    return (
        <div className="container mx-auto p-6 max-w-5xl flex flex-col h-full">
            <Heading icon={<Pencil />} title="Edit Project" />
            <div className="flex-grow overflow-auto mt-4">
                {projectId && <ProjectForm project_id={projectId} />}
            </div>
        </div>
    )
}
