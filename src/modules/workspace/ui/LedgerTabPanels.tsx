"use client";
import dynamic from "next/dynamic";
import {
  DetailsTabSkeleton,
  StatsTabSkeleton,
  SettingsTabSkeleton,
} from "@/components/skeletons/TabSkeletons";
import { DeferredFeatureMessages } from "@/i18n/DeferredFeatureMessages";
import { LedgerEntriesTab } from "@/modules/workspace/ui/LedgerEntriesTab";
import type { LedgerTab } from "@/lib/ledger-tabs";
import type { PeriodParams } from "@/lib/period-utils";
import type { EntryCategoryWithCount, LedgerDto } from "@/modules/ledger/contracts";
import type { EntryFilters } from "@/modules/ledger/ui/EntryFilterPanel";
import type { LedgerAdvancedFilters } from "@/modules/workspace/initial-query-state";
import type { InterfaceLanguage } from "@/modules/auth/contracts";

// Dynamic imports keep inactive tab dependencies out of the initial Stream bundle.
// Each inactive tab is lazily loaded by next/dynamic; its locale messages
// are loaded separately via DeferredFeatureMessages at the usage site
// so that the locale prop is available from the parent component scope.
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
  recordScope: "all" | "mine" | "partner";
  onRecordScopeChange: (scope: "all" | "mine" | "partner") => void;
  userId: string;
  partnerUserId: string;
  activeTab: LedgerTab;
  hidden: boolean;
  locale: string;
  ledgerId: string;
  ledger: LedgerDto;
  categories: EntryCategoryWithCount[];
  periodParams: PeriodParams;
  onFiltersChange: (filters: EntryFilters) => void;
  advancedFilters: LedgerAdvancedFilters;
  effectiveTimeZone?: string | undefined;
  ledgerToday?: string | undefined;
  onCategoryDrilldown: (categoryId: string, startDate: string, endDate: string) => void;
  onDateDrilldown: (
    date: string,
    filters?: { currency?: string | null; categoryId?: string | null }
  ) => void;
  userEmail?: string | undefined;
  hasPassword?: boolean | undefined;
  passwordUpdatedAt?: string | null | undefined;
  interfaceLanguage?: InterfaceLanguage | undefined;
  /** Owned by the page, because the tab that needs it is the tab that is mounted. */
  onRefresh?: () => Promise<unknown> | unknown;
  isRefreshing?: boolean | undefined;
  onGoToDetails?: (validCategoryIds: readonly string[]) => void;
}

/** Routes to whichever ledger tab is active; inactive tabs stay unmounted. */
export function LedgerTabPanels({
  recordScope,
  onRecordScopeChange,
  userId,
  partnerUserId,
  activeTab,
  hidden,
  locale,
  ledgerId,
  ledger,
  categories,
  periodParams,
  onFiltersChange,
  advancedFilters,
  effectiveTimeZone,
  ledgerToday,
  onCategoryDrilldown,
  onDateDrilldown,
  userEmail,
  hasPassword,
  passwordUpdatedAt,
  interfaceLanguage,
  onRefresh,
  isRefreshing,
  onGoToDetails,
}: LedgerTabPanelsProps) {
  return (
    <div className={hidden ? "hidden" : undefined} aria-hidden={hidden || undefined}>
      {activeTab === "stream" && (
        <div className="mt-0 min-w-0 max-w-full overflow-x-clip">
          <DeferredFeatureMessages feature="stream" locale={locale} fallback={null}>
            <LedgerEntriesTab
              recordScope={recordScope}
              onRecordScopeChange={onRecordScopeChange}
              userId={userId}
              partnerUserId={partnerUserId}
              ledgerId={ledgerId}
              ledger={ledger}
              periodParams={periodParams}
              onFiltersChange={onFiltersChange}
              advancedFilters={advancedFilters}
              collapseEntriesDefault={ledger.settings.collapseEntriesDefault}
              {...(effectiveTimeZone != null ? { timeZone: effectiveTimeZone } : {})}
              onRefresh={onRefresh}
              isRefreshing={isRefreshing}
            />
          </DeferredFeatureMessages>
        </div>
      )}

      {activeTab === "details" && (
        <div className="mt-0 min-w-0 max-w-full overflow-x-clip">
          <DeferredFeatureMessages
            feature="details"
            locale={locale}
            fallback={<DetailsTabSkeleton />}
          >
            <DetailsTab
              recordScope={recordScope}
              onRecordScopeChange={onRecordScopeChange}
              userId={userId}
              partnerUserId={partnerUserId}
              ledgerId={ledgerId}
              categories={categories.length > 0 ? categories : []}
              ledger={ledger}
              periodParams={periodParams}
              onFiltersChange={onFiltersChange}
              advancedFilters={advancedFilters}
              {...(effectiveTimeZone != null ? { timeZone: effectiveTimeZone } : {})}
              onRefresh={onRefresh}
              isRefreshing={isRefreshing}
            />
          </DeferredFeatureMessages>
        </div>
      )}

      {activeTab === "stats" && (
        <div className="mt-0 min-w-0 max-w-full overflow-x-clip">
          <DeferredFeatureMessages feature="stats" locale={locale} fallback={<StatsTabSkeleton />}>
            <StatsTab
              recordScope={recordScope}
              onRecordScopeChange={onRecordScopeChange}
              userId={userId}
              partnerUserId={partnerUserId}
              ledgerId={ledgerId}
              ledger={ledger}
              onCategoryDrilldown={onCategoryDrilldown}
              onDateDrilldown={onDateDrilldown}
              {...(ledgerToday !== undefined ? { ledgerToday } : {})}
              {...(effectiveTimeZone != null ? { timeZone: effectiveTimeZone } : {})}
            />
          </DeferredFeatureMessages>
        </div>
      )}

      {activeTab === "settings" && (
        <div className="mt-0 min-w-0 max-w-full overflow-x-clip">
          <DeferredFeatureMessages
            feature="settings"
            locale={locale}
            fallback={<SettingsTabSkeleton />}
          >
            <SettingsTab
              ledgerId={ledgerId}
              ledger={ledger}
              initialCategories={categories}
              userId={userId}
              partnerUserId={partnerUserId}
              {...(userEmail !== undefined ? { userEmail } : {})}
              {...(hasPassword !== undefined ? { hasPassword } : {})}
              {...(passwordUpdatedAt !== undefined ? { passwordUpdatedAt } : {})}
              {...(interfaceLanguage !== undefined ? { interfaceLanguage } : {})}
              {...(onGoToDetails == null ? {} : { onGoToDetails })}
            />
          </DeferredFeatureMessages>
        </div>
      )}
    </div>
  );
}
