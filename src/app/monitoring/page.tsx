import { redirect } from "next/navigation";

export default function MonitoringIndexPage() {
    redirect("/monitoring/logs");
}
