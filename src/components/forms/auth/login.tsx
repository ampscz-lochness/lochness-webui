"use client"
import { zodResolver } from "@hookform/resolvers/zod"
import Link from 'next/link'
import * as React from 'react'
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"

import { Button } from "@/components/ui/button"
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form"

import { Input } from "@/components/ui/input"
import { authClient } from "@/lib/auth-client"
import { useSearchParams } from 'next/navigation'

const formSchema = z.object({
    email: z.string()
        .min(1, "Email is required")
        .email("Email must be a valid email address"),
    password: z.string()
        .min(2, "Password must be at least 2 characters long")
        .max(128, "Password must be less than 128 characters long")
})

export type FormSchema = z.infer<typeof formSchema>

export default function LoginForm() {
    const [isLoading, setIsLoading] = React.useState(false)
    const searchParams = useSearchParams()

    const afterLoginParam = searchParams.get('afterLogin')
    const redirectPath = afterLoginParam ? decodeURIComponent(afterLoginParam) : '/'
    console.log('redirect path:', redirectPath)


    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            email: "",
            password: "",
        }
    })

    const onSubmit = async (data: z.infer<typeof formSchema>) => {
        setIsLoading(true)

        const { email, password } = data;

        // Create a promise to handle the login
        const loginPromise = new Promise((resolve, reject) => {
            authClient.signIn.email({
                email,
                password,
                rememberMe: false,
            }, {
                onSuccess: (data) => {
                    resolve(data);
                    // Hard redirect so the browser sends the fresh session cookie
                    // in the next request; client-side push fires before the cookie
                    // is committed and the middleware rejects it.
                    window.location.href = redirectPath;
                },
                onError: (error) => {
                    console.log({ error });
                    reject(error);
                }
            })
        });

        toast.promise(loginPromise, {
            loading: "Logging in...",
            success: () => {
                setIsLoading(false)
                return "Logged in successfully!";
            },
            error: () => {
                setIsLoading(false)
                return "Failed to log in. Please check your credentials.";
            }
        })
        // Removed setIsLoading(false) from here as it would run immediately
    }

    return (
        <div className="container mx-auto p-6 max-w-2xl">
            <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                    <FormField
                        control={form.control}
                        name="email"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Email</FormLabel>
                                <FormControl>
                                    <Input placeholder="Email" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="password"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Password</FormLabel>
                                <FormControl>
                                    <Input type="password" placeholder="Password" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <Button type="submit" disabled={isLoading} className="w-full">
                        {isLoading ? "Logging in..." : "Login"}
                    </Button>

                    <div className="text-sm text-center text-gray-500 pt-2">
                        Do not have an account?{" "}

                        <Button asChild variant="link" type="button" className="p-0 h-auto font-medium text-blue-500 hover:underline">
                            <Link href="/auth/register">
                                Register
                            </Link>
                        </Button>
                    </div>
                </form>
            </Form>
        </div>
    )
}
