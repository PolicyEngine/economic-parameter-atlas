"use client";

import { useEffect, useState } from "react";

import { DashboardClient } from "@/components/dashboard-client";
import summaryData from "@/data/dashboard-summary.json";
import type { DashboardSummaryData } from "@/lib/dashboard-types";

const data = summaryData as DashboardSummaryData;

export default function Home() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  return <DashboardClient data={data} />;
}
