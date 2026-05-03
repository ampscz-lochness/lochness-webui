"use client"
import * as React from 'react'
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { toast } from "sonner";

import { Pencil, Eraser } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Project } from '@/types/projects'

const formSchema = z.object({
    project_id: z.string()
        .min(1, "Project ID is required")
        .regex(/^[a-zA-Z0-9_-]+$/, "Project ID must contain only letters, numbers, underscores, and hyphens"),
    project_name: z.string().min(1, "Project Name is required"),
    project_is_active: z.boolean(),
    project_description: z.string()
        .max(500, "Project Description must be less than 500 characters")
        .optional()
})

export type FormSchema = z.infer<typeof formSchema>

export type ProjectFormProps = {
    project_id: string | null
}

export default function ProjectForm({
    project_id,
}: ProjectFormProps) {

    const [project, setProject] = React.useState<Project | null>(null)

    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            project_id: project_id ? project_id : "",
            project_name: "",
            project_is_active: undefined,
            project_description: "",
        }
    })

    React.useEffect(() => {
        const fetchProject = async () => {
            try {
                const response = await fetch(`/api/v1/projects/${project_id}`)
                if (!response.ok) {
                    throw new Error('Failed to fetch project')
                }
                const data = await response.json()
                setProject(data)
            } catch (error) {
                console.error(error)
                toast.error('Failed to fetch project')
            }
        }

        if (project_id) {
            fetchProject()
        }
        // If project_id is null, it means we are creating a new project
        // If creating a new project, no need to fetch

    }, [project_id])


    React.useEffect(() => {
        form.reset({
            project_id: project_id ? project_id : "",
            project_name: project?.project_name || "",
            project_is_active: project?.project_is_active || undefined,
            project_description: project?.project_metadata?.description || undefined,
        });
    }, [project, project_id, form])

    function handleFormSubmit(values: z.infer<typeof formSchema>) {
        const formData = {
            ...values,
        }

        const body = {
            project_id: formData.project_id,
            project_name: formData.project_name,
            project_is_active: formData.project_is_active,
            project_metadata: {
                description: formData.project_description,
                created_at: new Date().toISOString(),
            }
        }

        if (project) {
            body.project_metadata.created_at = project.project_metadata.created_at
        }

        fetch(`/api/v1/projects`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
        })
            .then((response) => {
                if (!response.ok) {
                    throw new Error("Network response was not ok");
                }
                return response.json();
            })
            .then(() => {
                if (project) {
                    toast.success("Updated Project successfully");
                } else {
                    toast.success("Added Project successfully");
                }
                // Take user to the project page
                window.location.href = `/config/projects/${formData.project_id}`;
            })
            .catch((error) => {
                if (project) {
                    toast.error("Failed to update project");
                } else {
                    toast.error("Failed to add project");
                }
                console.error("Error:", error);
            });
    }

    return (
        <div className="container mx-auto p-6 max-w-2xl">
              <Form {...form}>
                <form onSubmit={form.handleSubmit(handleFormSubmit)} className="space-y-8">
                    <div className="sm:border sm:rounded-lg sm:p-6 sm:bg-slate-50 sm:dark:bg-slate-900 sm:shadow-sm">
                        {/* <h2 className="text-xl font-semibold mb-6 text-slate-800 dark:text-slate-200 border-b pb-3 border-slate-200 dark:border-slate-700 flex items-center gap-2"><Plus className="w-5 h-5" /> Create New Project</h2> */}

                        <div className="space-y-6">
                            <FormField
                                control={form.control}
                                name="project_id"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="font-medium">Project ID</FormLabel>
                                        <FormControl>
                                            <Input 
                                                placeholder="Enter project ID" 
                                                {...field} 
                                                disabled={!!project}
                                                className="bg-white dark:bg-slate-800" 
                                            />
                                        </FormControl>
                                        <FormDescription className="text-xs">
                                            A unique identifier for the project (e.g., PRESCIENT, ProNET)
                                        </FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="project_name"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="font-medium">Project Name</FormLabel>
                                        <FormControl>
                                            <Input placeholder="Enter project name" {...field} className="bg-white dark:bg-slate-800" />
                                        </FormControl>
                                        <FormDescription className="text-xs">
                                            A descriptive name for your project
                                        </FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="project_is_active"
                                render={({ field }) => (
                                    <FormItem className="flex items-center space-x-2">
                                        <FormControl>
                                            <Checkbox
                                                checked={field.value}
                                                onCheckedChange={field.onChange}
                                                className="h-4 w-4"
                                            />
                                        </FormControl>
                                        <FormLabel className="font-medium">Is Active</FormLabel>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <FormField
                                control={form.control}
                                name="project_description"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="font-medium">Project Description</FormLabel>
                                        <FormControl>
                                            <Textarea placeholder="Enter project description (Optional)" {...field} className="bg-white dark:bg-slate-800 h-32" />
                                        </FormControl>
                                        <FormDescription className="text-xs">
                                            A brief description of the project (max 500 characters)
                                        </FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>
                    </div>

                    <div className="flex gap-4 items-center justify-end">
                        <Button type="button" variant="outline" onClick={() => form.reset()}>
                            <Eraser /> Reset
                        </Button>
                        <Button type="submit" variant="default" className="px-8">
                            <Pencil /> Update Project
                        </Button>
                    </div>
                </form>
            </Form>
        </div>
    )
}
