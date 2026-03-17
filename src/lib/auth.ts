// Reference:
// https://www.better-auth.com/docs/installation
// https://www.better-auth.com/docs/authentication/email-password

import { betterAuth } from "better-auth";

import { getConnection } from "@/lib/db";

export const auth = betterAuth({
    database: getConnection(),
    emailAndPassword: {
        enabled: true,
        minPasswordLength: 2,
        autoSignIn: false,
    },
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL ?? process.env.NEXTAUTH_URL,
    trustedOrigins: [
        process.env.BETTER_AUTH_URL,
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:3002",
    ].filter(Boolean) as string[],
})
