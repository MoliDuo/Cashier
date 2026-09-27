import type { ReactNode } from "react";
import type { LedgerPage } from "@/lib/ledger-tabs";
import {
  DetailsTabSkeleton,
  EntriesTabSkeleton,
  SettingsTabSkeleton,
  StatsTabSkeleton,
} from "./TabSkeletons";

/**
 * Skeleton component for the main ledger page
 * Shows immediately while server-side data is loading
 */
export function LedgerPageSkeleton({ page = "documents" }: { page?: LedgerPage }) {
  const contentByPage: Record<LedgerPage, ReactNode> = {
    documents: <EntriesTabSkeleton />,
    entries: <DetailsTabSkeleton />,
    stats: <StatsTabSkeleton />,
    settings: <SettingsTabSkeleton />,
  };

  return (
    <div aria-hidden="true" className="min-h-screen bg-bg text-text">
      {/* Header skeleton */}
      <header className="sticky top-0 z-header border-b border-border bg-surface">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-3 sm:px-4 md:px-6">
          <div className="h-4 w-16 animate-pulse rounded bg-surface2" />
          <div className="h-9 w-9 animate-pulse rounded-md bg-primary/20" />
        </div>
      </header>

      <main className="relative z-content mx-auto w-full max-w-6xl px-3 py-4 sm:px-4 md:px-6">
        {contentByPage[page]}
      </main>
    </div>
  );
}
