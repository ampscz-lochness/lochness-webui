import {
    Github,
    LayoutDashboard,
    MessageSquareWarning,
} from "lucide-react"

export const navData = {
    navMain: [
        {
            title: "Monitoring",
            icon: MessageSquareWarning,
            url: "/monitoring",
            isActive: true,
            items: [
                {
                    title: "Failed Data Ingestions",
                    url: "/issues/failed-ingestions",
                    isActive: false,
                },
                {
                    title: "Logs",
                    url: "/monitoring/logs",
                    isActive: false,
                },
                {
                    title: "Day Tracker",
                    url: "/monitoring/daytracker",
                    isActive: false,
                },
                {
                    title: "SharePoint Tracker",
                    url: "/monitoring/sharepoint",
                    isActive: false,
                },
                {
                    title: "Server Uptime",
                    url: "/monitoring/server-uptime",
                    isActive: false,
                },
            ],
        },
        {
            title: "Configurations",
            icon: LayoutDashboard,
            url: "/config",
            isActive: true,
            items: [
                {
                    title: "Projects",
                    url: "/config/projects",
                    isActive: false,
                },
                // {
                //     title: "Sites",
                //     url: "/config/sites",
                //     isActive: false,
                // },
                // {
                //     title: "Data Sources",
                //     url: "/config/data-sources",
                //     isActive: false,
                // },
                // {
                //     title: "Data Sinks",
                //     url: "/config/data-sinks",
                //     isActive: false,
                // },
            ],
        },
    ],
    navSecondary: [
        {
            title: "Lochness - GitHub",
            url: "https://github.com/dheshanm/lochness",
            icon: Github,
        },
        {
            title: "Lochness WebUI - GitHub",
            url: "https://github.com/dheshanm/lochness-webui",
            icon: Github,
        },
    ],
}
