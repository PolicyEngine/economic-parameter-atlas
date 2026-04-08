import { DashboardClient } from "@/components/dashboard-client";
import summaryData from "@/data/dashboard-summary.json";
import type { DashboardSummaryData } from "@/lib/dashboard-types";

const data = summaryData as DashboardSummaryData;

export default function Home() {
  return <DashboardClient data={data} />;
}
