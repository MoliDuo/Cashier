"use client";
import { usePathname } from "next/navigation";
import {
  DetailsTabSkeleton,
  EntriesTabSkeleton,
  SettingsTabSkeleton,
  StatsTabSkeleton,
} from "@/components/skeletons/TabSkeletons";
import { ledgerTabFromPathname } from "@/lib/ledger-tabs";

/** The skeleton of whichever route is loading, while its first data is fetched. */
export function LedgerRouteFallback() {
  const activeTab = ledgerTabFromPathname(usePathname());
  if (activeTab === "details") return <DetailsTabSkeleton />;
  if (activeTab === "stats") return <StatsTabSkeleton />;
  if (activeTab === "settings") return <SettingsTabSkeleton />;
  return <EntriesTabSkeleton />;
}
