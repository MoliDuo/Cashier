"use client";
import dynamic from "next/dynamic";
import {
  EntriesTabSkeleton,
  DetailsTabSkeleton,
  StatsTabSkeleton,
  SettingsTabSkeleton,
} from "@/components/skeletons/TabSkeletons";
import { LedgerEntriesTab } from "@/modules/workspace/ui/LedgerEntriesTab";
import { BookReveal } from "@/modules/workspace/ui/BookReveal";
import type { BookDto } from "@/modules/ledger/contracts";
import type { LedgerTab } from "@/lib/ledger-tabs";
import type { PeriodParams } from "@/lib/period-utils";
import type { EntryCategoryWithCount, LedgerDto } from "@/modules/ledger/contracts";
import type { EntryFilters } from "@/modules/ledger/ui/EntryFilterPanel";
import type { RecordScope } from "@/modules/ledger/filters";
import type { LedgerAdvancedFilters } from "@/modules/workspace/initial-query-state";

// Dynamic imports keep inactive tab dependencies out of the initial Stream bundle.
const DetailsTab = dynamic(
  () => import("@/modules/workspace/ui/DetailsTab").then((m) => m.DetailsTab),
  { loading: () => <DetailsTabSkeleton /> }
);

const StatsTab = dynamic(() => import("@/modules/workspace/ui/StatsTab").then((m) => m.StatsTab), {
  loading: () => <StatsTabSkeleton />,
});

const SettingsTab = dynamic(
  () => import("@/modules/ledger/ui/SettingsTab").then((m) => m.SettingsTab),
  { loading: () => <SettingsTabSkeleton /> }
);

interface LedgerTabPanelsProps {
  recordScope: RecordScope;
  onRecordScopeChange: (scope: RecordScope) => void;
  /** The switcher's books, in configured order. */
  books: readonly BookDto[];
  activeTab: LedgerTab;
  hidden: boolean;
  ledger: LedgerDto;
  categories: EntryCategoryWithCount[];
  periodParams: PeriodParams;
  onFiltersChange: (filters: EntryFilters) => void;
  advancedFilters: LedgerAdvancedFilters;
  effectiveTimeZone?: string | undefined;
  /**
   * False while the reader's zone is still unknown. The three date-driven tabs
   * then show their own skeleton instead of mounting a query for the wrong day;
   * 设置 is not dated, so it is unaffected.
   */
  timeZoneReady: boolean;
  ledgerToday?: string | undefined;
  onCategoryDrilldown: (categoryId: string, startDate: string, endDate: string) => void;
  onDateDrilldown: (
    date: string,
    filters?: { currency?: string | null; categoryId?: string | null }
  ) => void;
  userEmail?: string | undefined;
  hasPassword?: boolean | undefined;
  passwordUpdatedAt?: string | null | undefined;
  onGoToDetails?: (validCategoryIds: readonly string[]) => void;
}

/** Routes to whichever ledger tab is active; inactive tabs stay unmounted. */
export function LedgerTabPanels({
  recordScope,
  onRecordScopeChange,
  books,
  activeTab,
  hidden,
  ledger,
  categories,
  periodParams,
  onFiltersChange,
  advancedFilters,
  effectiveTimeZone,
  timeZoneReady,
  ledgerToday,
  onCategoryDrilldown,
  onDateDrilldown,
  userEmail,
  hasPassword,
  passwordUpdatedAt,
  onGoToDetails,
}: LedgerTabPanelsProps) {
  const carriesBookSwitch = activeTab !== "settings" && books.length > 0;

  return (
    <div className={hidden ? "hidden" : undefined} aria-hidden={hidden || undefined}>
      {carriesBookSwitch ? (
        <BookReveal books={books} scope={recordScope} onScopeChange={onRecordScopeChange} />
      ) : null}
      {activeTab === "stream" && (
        <div className="mt-0 min-w-0 max-w-full overflow-x-clip">
          {timeZoneReady ? (
            <LedgerEntriesTab
              bookId={recordScope ?? undefined}
              ledger={ledger}
              periodParams={periodParams}
              onFiltersChange={onFiltersChange}
              advancedFilters={advancedFilters}
              collapseEntriesDefault={ledger.settings.collapseEntriesDefault}
              {...(effectiveTimeZone != null ? { timeZone: effectiveTimeZone } : {})}
            />
          ) : (
            <EntriesTabSkeleton />
          )}
        </div>
      )}

      {activeTab === "details" && (
        <div className="mt-0 min-w-0 max-w-full overflow-x-clip">
          {timeZoneReady ? (
            <DetailsTab
              bookId={recordScope ?? undefined}
              categories={categories.length > 0 ? categories : []}
              ledger={ledger}
              periodParams={periodParams}
              onFiltersChange={onFiltersChange}
              advancedFilters={advancedFilters}
              {...(effectiveTimeZone != null ? { timeZone: effectiveTimeZone } : {})}
            />
          ) : (
            <DetailsTabSkeleton />
          )}
        </div>
      )}

      {activeTab === "stats" && (
        <div className="mt-0 min-w-0 max-w-full overflow-x-clip">
          {timeZoneReady ? (
            <StatsTab
              bookId={recordScope ?? undefined}
              ledger={ledger}
              onCategoryDrilldown={onCategoryDrilldown}
              onDateDrilldown={onDateDrilldown}
              {...(ledgerToday !== undefined ? { ledgerToday } : {})}
              {...(effectiveTimeZone != null ? { timeZone: effectiveTimeZone } : {})}
            />
          ) : (
            <StatsTabSkeleton />
          )}
        </div>
      )}

      {activeTab === "settings" && (
        <div className="mt-0 min-w-0 max-w-full overflow-x-clip">
          <SettingsTab
            ledger={ledger}
            initialCategories={categories}
            initialBooks={books}
            {...(userEmail !== undefined ? { userEmail } : {})}
            {...(hasPassword !== undefined ? { hasPassword } : {})}
            {...(passwordUpdatedAt !== undefined ? { passwordUpdatedAt } : {})}
            {...(onGoToDetails == null ? {} : { onGoToDetails })}
          />
        </div>
      )}
    </div>
  );
}
