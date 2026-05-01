import type { Metadata } from "next";
import "./globals.css";

import { AppSidebar } from "@/components/layout/sidebar/sidebar";
import {
    SidebarInset,
    SidebarProvider,
} from "@/components/ui/sidebar"
import AppHeader from "@/components/layout/header";
import { Toaster } from "@/components/ui/sonner"
import { ThemeProvider } from "@/components/theme-provider"

if (typeof window === "undefined") {
    let hasUsableLocalStorage = false

    try {
        const localStorageCandidate = (globalThis as { localStorage?: unknown }).localStorage
        hasUsableLocalStorage =
            !!localStorageCandidate &&
            (typeof localStorageCandidate === "object" || typeof localStorageCandidate === "function") &&
            typeof (localStorageCandidate as { getItem?: unknown }).getItem === "function"
    } catch {
        hasUsableLocalStorage = false
    }

    if (!hasUsableLocalStorage) {
        const memoryStore = new Map<string, string>()

        const safeStorage = {
            getItem: (key: string) => memoryStore.get(String(key)) ?? null,
            setItem: (key: string, value: string) => {
                memoryStore.set(String(key), String(value))
            },
            removeItem: (key: string) => {
                memoryStore.delete(String(key))
            },
            clear: () => {
                memoryStore.clear()
            },
            key: (index: number) => Array.from(memoryStore.keys())[index] ?? null,
            get length() {
                return memoryStore.size
            },
        }

        Object.defineProperty(globalThis, "localStorage", {
            value: safeStorage,
            configurable: true,
            writable: true,
        })
    }
}

export const metadata: Metadata = {
    title: "Lochness - WebUI",
    description: "WebUI for Lochness",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en" suppressHydrationWarning={true}>
            <body className='antialiased'>
                <ThemeProvider
                    attribute="class"
                    defaultTheme="dark"
                    disableTransitionOnChange
                >
                    <SidebarProvider>
                        <AppSidebar />
                        <SidebarInset>
                            <AppHeader />
                            {children}
                            <Toaster closeButton />
                        </SidebarInset>
                    </SidebarProvider>
                </ThemeProvider>
            </body>
        </html>
    );
}
