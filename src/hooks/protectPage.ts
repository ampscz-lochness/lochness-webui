import { authClient } from "@/lib/auth-client";
import { useRouter, usePathname } from "next/navigation";
import React from "react";
import { toast } from "sonner";


interface ProtectPageOptions {
    redirectTo?: string;
    message?: string;
    description?: string;
    afterLogin?: string;
    /** Require a specific user role (e.g. "admin"). Redirects to `unauthorizedRedirectTo` if the logged-in user lacks this role. */
    role?: string;
    /** Where to send a logged-in user who lacks the required role. Defaults to "/". */
    unauthorizedRedirectTo?: string;
}

const useProtectPage = ({
    redirectTo = "/auth/login",
    message = "You must be logged in to view this page",
    description = "Redirecting to login page...",
    afterLogin: afterLoginProp,
    role,
    unauthorizedRedirectTo = "/",
}: ProtectPageOptions = {}) => {
    const router = useRouter();
    const pathname = usePathname();
    const { data: session } = authClient.useSession();

    const afterLogin = afterLoginProp ?? pathname;

    React.useEffect(() => {
        if (!session?.user?.email) {
            toast.error(message, {
                duration: 5000,
                description,
            });

            const redirectPath = `${redirectTo}?afterLogin=${encodeURIComponent(afterLogin)}`

            const timer = setTimeout(() => {
                router.push(redirectPath);
            }, 100); // Add a 100ms delay before redirecting

            // Cleanup function to clear the timeout if the component unmounts
            // or dependencies change before the timeout finishes
            return () => clearTimeout(timer);
        } else if (role && (session.user as { role?: string | null }).role !== role) {
            toast.error("Access denied", {
                duration: 5000,
                description: "You don't have permission to view this page.",
            });

            const timer = setTimeout(() => {
                router.push(unauthorizedRedirectTo);
            }, 100);

            return () => clearTimeout(timer);
        }
    }, [session, message, description, redirectTo, afterLogin, role, unauthorizedRedirectTo, router]);
};

export default useProtectPage;
