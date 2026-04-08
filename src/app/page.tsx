import { Suspense } from "react";
import { DashboardClient } from "@/components/dashboard-client";
import summaryData from "@/data/dashboard-summary.json";
import type { DashboardSummaryData } from "@/lib/dashboard-types";

const data = summaryData as DashboardSummaryData;

export default function Home() {
  return (
    <Suspense fallback={null}>
      <DashboardClient data={data} />
    </Suspense>
  );
}
