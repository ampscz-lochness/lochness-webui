import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PAGE_PREFIXES = ["/auth/login", "/auth/register"];

const isPublicPath = (pathname: string): boolean => {
    if (pathname.startsWith("/_next")) return true;
    if (pathname.startsWith("/api/auth")) return true;
    if (pathname === "/favicon.ico") return true;
    if (pathname === "/robots.txt") return true;
    if (pathname === "/sitemap.xml") return true;
    return PUBLIC_PAGE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
};

const hasValidSession = async (request: NextRequest): Promise<boolean> => {
    const sessionUrl = new URL("/api/auth/get-session", request.url);
    const cookie = request.headers.get("cookie") ?? "";

    try {
        const response = await fetch(sessionUrl, {
            method: "GET",
            headers: {
                cookie,
            },
            cache: "no-store",
        });

        if (!response.ok) return false;

        const payload = await response.json();

        // Better Auth get-session returns { session: { userId, ... }, user: { id, email, ... } }
        return Boolean(payload?.user?.id || payload?.session?.userId);
    } catch {
        return false;
    }
};

export async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    if (isPublicPath(pathname)) {
        return NextResponse.next();
    }

    const authenticated = await hasValidSession(request);

    if (authenticated) {
        return NextResponse.next();
    }

    if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const loginUrl = new URL("/auth/login", request.url);
    loginUrl.searchParams.set("afterLogin", pathname);
    return NextResponse.redirect(loginUrl);
}

export const config = {
    matcher: ["/:path*"],
};
