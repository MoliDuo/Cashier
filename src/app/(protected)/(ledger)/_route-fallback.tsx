"use client";
import { usePathname, useSearchParams } from "next/navigation";
import {
  DetailsTabSkeleton,
  EntriesTabSkeleton,
  SettingsTabSkeleton,
  StatsTabSkeleton,
} from "@/components/skeletons/TabSkeletons";
import { ledgerPageFor, ledgerTabFromPathname } from "@/lib/ledger-tabs";

/** The skeleton of whichever route is loading, while its first data is fetched. */
export function LedgerRouteFallback() {
  const page = ledgerPageFor(ledgerTabFromPathname(usePathname()), useSearchParams());
  if (page === "entries") return <DetailsTabSkeleton />;
  if (page === "stats") return <StatsTabSkeleton />;
  if (page === "settings") return <SettingsTabSkeleton />;
  return <EntriesTabSkeleton />;
}
