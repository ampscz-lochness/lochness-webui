"use client";
import { createAuthClient } from "better-auth/react"
import { adminClient } from "better-auth/client/plugins"

// `better-auth/react` can touch browser storage at initialization.
// Guard server rendering to avoid localStorage access on Node.
const serverAuthClient = {
    useSession: () => ({ data: null }),
} as unknown as ReturnType<typeof createAuthClient>

export const authClient =
    typeof window === "undefined" ? serverAuthClient : createAuthClient({
        plugins: [adminClient()],
    })
