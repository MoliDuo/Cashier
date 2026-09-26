"use client";
import { StatsTabSkeleton } from "@/components/skeletons/TabSkeletons";
import { useDrilldownNavigation } from "../../hooks/useDrilldownNavigation";
import { StatsTab } from "../StatsTab";
import { useLedgerWorkspace } from "../ledger-workspace-context";

/** 统计: totals over a period, each of which drills down into 明细. */
export function StatsRoute() {
  const { ledger, recordScope, effectiveTimeZone, timeZoneReady, ledgerToday } =
    useLedgerWorkspace();
  const { handleCategoryDrilldown, handleDateDrilldown } = useDrilldownNavigation(
    recordScope == null ? {} : { bookId: recordScope }
  );

  if (!timeZoneReady) return <StatsTabSkeleton />;
  return (
    <StatsTab
      bookId={recordScope ?? undefined}
      ledger={ledger}
      onCategoryDrilldown={handleCategoryDrilldown}
      onDateDrilldown={handleDateDrilldown}
      {...(ledgerToday !== undefined ? { ledgerToday } : {})}
      {...(effectiveTimeZone != null ? { timeZone: effectiveTimeZone } : {})}
    />
  );
}
