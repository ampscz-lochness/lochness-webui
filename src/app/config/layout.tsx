"use client";

import useProtectPage from "@/hooks/protectPage";

export default function ConfigLayout({ children }: { children: React.ReactNode }) {
    useProtectPage({ role: "admin" });
    return <>{children}</>;
}
