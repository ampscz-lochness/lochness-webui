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
