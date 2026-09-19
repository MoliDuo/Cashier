"use client";
import { useSearchParams } from "next/navigation";
import { useLocale, useMessages, useTranslations } from "next-intl";
import { usePathname } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { FEATURE_MESSAGES } from "@/i18n/client-feature-messages";
import { DeferredFeatureMessages } from "@/i18n/DeferredFeatureMessages";
import { useFeatureMessages } from "@/i18n/use-feature-messages";
import { useDrilldownNavigation } from "../hooks/useDrilldownNavigation";
import { useLedgerHistorySync } from "../hooks/useLedgerHistorySync";
import { useLedgerTabs } from "../hooks/useLedgerTabs";
import { usePeriodFilter } from "../hooks/usePeriodFilter";
import { useActiveTabQueryState } from "../hooks/useActiveTabQueryState";
import { useNewRecordDialogState } from "../hooks/useNewRecordDialogState";
import { useLedgerPageEnvironment } from "../hooks/useLedgerPageEnvironment";
import { useRecordScope } from "../hooks/useRecordScope";
import type { LedgerTab } from "@/lib/ledger-tabs";
import type { InterfaceLanguage } from "@/modules/auth/contracts";
import { LedgerQueryErrorBanner } from "@/modules/workspace/ui/LedgerQueryErrorBanner";
import type { EntryCategoryWithCount, LedgerDto } from "@/modules/ledger/contracts";
import type { BookDto } from "@/modules/ledger/contracts";
import { useBooks } from "@/modules/ledger/hooks/useBooks";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { textRoleClassName } from "@/components/typography";
import { LedgerTabPanels } from "./LedgerTabPanels";
import { NewRecordDialog } from "./NewRecordDialog";
import { RefreshButton } from "@/components/ui/refresh-button";
import { ModalStackGate } from "./ModalStackGate";
import { useCategoryAssignmentJob } from "@/modules/ledger/hooks/useCategoryAssignmentJob";
import { CategoryAssignmentStatus } from "@/modules/ledger/ui/CategoryAssignmentStatus";
import { pushLedgerUrl } from "../ledger-url-navigation";

interface LedgerPageClientProps {
  ledgerId: string;
  userId: string;
  initialLedger?: LedgerDto;
  initialTab: LedgerTab;
  ledgerToday?: string;
  initialCategories?: EntryCategoryWithCount[];
  /** The switcher's books, hydrated by the page bootstrap. */
  initialBooks?: readonly BookDto[];
  /** The book this device's cookie resolved to, null for 总账. */
  initialBookId?: string | null;
  /**
   * The device zone the server read from this browser's cookie. The tabs date by
   * it when the viewed book has no zone of its own, so a page that arrives
   * without one mounts its date queries only after the browser has answered.
   */
  initialDeviceTimeZone?: string | null;
  /** Server-derived user email for the Settings tab (avoids useSession). */
  userEmail?: string;
  hasPassword?: boolean;
  passwordUpdatedAt?: string | null;
  interfaceLanguage?: InterfaceLanguage;
}

function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded bg-surface2", className)} />;
}

function getFeatureForTab(activeTab: LedgerTab): keyof typeof FEATURE_MESSAGES {
  return activeTab === "details"
    ? "details"
    : activeTab === "stats"
      ? "stats"
      : activeTab === "settings"
        ? "settings"
        : "stream";
}

export function LedgerPageClient({
  ledgerId,
  initialLedger,
  initialTab,
  ledgerToday,
  initialCategories,
  initialBooks,
  initialBookId,
  initialDeviceTimeZone,
  userEmail,
  hasPassword,
  passwordUpdatedAt,
  interfaceLanguage,
}: LedgerPageClientProps) {
  const t = useTranslations("LedgerPage");
  const tCommon = useTranslations("Common");
  const locale = useLocale();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { books } = useBooks({
    ledgerId,
    ...(initialBooks !== undefined ? { initialBooks } : {}),
  });
  // null is 总账. The scope is this device's remembered choice — seeded from
  // what the server resolved out of the scope cookie, written back to it on
  // every change — so a reload or a new tab picks up where the reader left off.
  const { recordScope, onRecordScopeChange: handleRecordScopeChange } = useRecordScope({
    books,
    initialScope: initialBookId ?? null,
  });
  const categoryAssignment = useCategoryAssignmentJob(ledgerId);

  const { activeTab, handleTabChange: _handleTabChange } = useLedgerTabs({
    initialTab,
    searchParams,
    pathname,
    locale,
  });
  useLedgerHistorySync({
    pathname,
    searchParams,
    ledgerId,
    locale,
    legacyScope: activeTab === "details" ? "details" : "stream",
  });

  const parentMessages = useMessages();
  const activeFeature = getFeatureForTab(activeTab);
  const activeFeatureMessages = useFeatureMessages(
    locale,
    activeFeature,
    parentMessages as Record<string, unknown>
  );
  const activeFeatureStatus = activeFeatureMessages.status;
  const retryFeatureMessages = activeFeatureMessages.retry;

  const newRecordDialog = useNewRecordDialogState({ ledgerId });
  const {
    isInputOpen,
    setIsInputOpen,
    inputMode,
    setInputMode,
    setAiPending,
    setQuickPending,
    aiDirty,
    setAiDirty,
    quickDirty,
    setQuickDirty,
    isInputSubmitting,
    handleDialogOpenChange,
    discardConfirmOpen,
    setDiscardConfirmOpen,
    confirmDiscard,
  } = newRecordDialog;

  const {
    ledger,
    categoriesQuery,
    categories,
    categoriesHaveNoData,
    mainCurrency,
    preferredCurrencies,
    effectiveTimeZone,
    deviceTimeZone,
    timeZoneReady,
    dirtyChangeCount,
  } = useLedgerPageEnvironment({
    ledgerId,
    scope: recordScope,
    initialLedger,
    initialCategories,
    ...(initialBooks !== undefined ? { initialBooks } : {}),
    initialDeviceTimeZone: initialDeviceTimeZone ?? null,
    setIsInputOpen,
  });

  const { periodParams, filters, filterParams, handleFiltersChange } = usePeriodFilter({
    pathname,
    searchParams,
    locale,
    scope: activeTab === "details" ? "details" : "stream",
    ...(effectiveTimeZone != null ? { timeZone: effectiveTimeZone } : {}),
  });

  const advancedFilters = filterParams;
  const { isRefreshing, refreshActiveTab } = useActiveTabQueryState({
    ledgerId,
    activeTab,
  });
  const { handleCategoryDrilldown, handleDateDrilldown } = useDrilldownNavigation({
    searchParams,
    pathname,
    ledgerId,
    locale,
    ...(recordScope == null ? {} : { bookId: recordScope }),
  });
  const handleGoToDetails = (validCategoryIds: readonly string[]) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "details");
    const categoryId = params.get("detailsCategoryId");
    if (
      categoryId != null &&
      categoryId !== "__uncategorized__" &&
      !validCategoryIds.includes(categoryId)
    ) {
      params.delete("detailsCategoryId");
    }
    pushLedgerUrl(pathname, params, locale, "tab");
  };

  if (ledger == null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <h1 className={textRoleClassName("pageTitle")}>{t("notFound")}</h1>
      </div>
    );
  }

  return (
    <>
      <div>
        {categoryAssignment.isVisible ? (
          <DeferredFeatureMessages feature="details" locale={locale} fallback={null}>
            <CategoryAssignmentStatus
              ledgerId={ledgerId}
              job={categoryAssignment.job}
              isReadError={categoryAssignment.isReadError}
              onRefresh={categoryAssignment.refresh}
              onDismiss={categoryAssignment.dismiss}
            />
          </DeferredFeatureMessages>
        ) : null}
        {/* The stream and details tabs refresh from their own toolbar box, so
            only the tabs without one keep the bar. */}
        {activeTab === "stats" || activeTab === "settings" ? (
          <div className="flex h-9 items-center justify-end px-2">
            <RefreshButton
              onRefresh={refreshActiveTab}
              isRefreshing={isRefreshing}
              disabled={activeTab === "settings" && dirtyChangeCount > 0}
            />
          </div>
        ) : null}
        {/* Only mount the active tab — inactive tabs load lazily */}
        {activeFeatureStatus === "error" ? (
          <LedgerQueryErrorBanner empty onRetry={retryFeatureMessages} />
        ) : null}
        {categoriesQuery.isError ? (
          <LedgerQueryErrorBanner
            empty={categoriesHaveNoData}
            onRetry={() => void categoriesQuery.refetch()}
          />
        ) : null}
        {categoriesQuery.isPending && categoriesHaveNoData ? (
          <div className="space-y-3 px-2 py-4" role="status" aria-busy="true">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : null}

        <LedgerTabPanels
          recordScope={recordScope}
          onRecordScopeChange={handleRecordScopeChange}
          books={books ?? []}
          activeTab={activeTab}
          hidden={categoriesHaveNoData}
          locale={locale}
          ledgerId={ledgerId}
          ledger={ledger}
          categories={categories}
          periodParams={periodParams}
          onFiltersChange={handleFiltersChange}
          advancedFilters={advancedFilters}
          effectiveTimeZone={effectiveTimeZone}
          timeZoneReady={timeZoneReady}
          ledgerToday={ledgerToday}
          onCategoryDrilldown={handleCategoryDrilldown}
          onDateDrilldown={handleDateDrilldown}
          userEmail={userEmail}
          hasPassword={hasPassword}
          passwordUpdatedAt={passwordUpdatedAt}
          interfaceLanguage={interfaceLanguage}
          onRefresh={refreshActiveTab}
          isRefreshing={isRefreshing}
          onGoToDetails={handleGoToDetails}
        />

        <NewRecordDialog
          scope={recordScope}
          books={books ?? []}
          isOpen={isInputOpen}
          onOpenChange={handleDialogOpenChange}
          isSubmitting={isInputSubmitting}
          locale={locale}
          ledgerId={ledgerId}
          activeTab={activeTab}
          committedFilters={filters}
          inputMode={inputMode}
          setInputMode={setInputMode}
          categories={categories}
          mainCurrency={mainCurrency}
          preferredCurrencies={preferredCurrencies}
          aiDirty={aiDirty}
          quickDirty={quickDirty}
          setInputOpen={setIsInputOpen}
          setAiPending={setAiPending}
          setQuickPending={setQuickPending}
          setAiDirty={setAiDirty}
          setQuickDirty={setQuickDirty}
          deviceTimeZone={deviceTimeZone}
        />

        <ConfirmDialog
          open={discardConfirmOpen}
          onOpenChange={setDiscardConfirmOpen}
          title={tCommon("unsavedChangesTitle")}
          description={tCommon("unsavedChangesDescription")}
          confirmLabel={tCommon("discard")}
          variant="destructive"
          onConfirm={confirmDiscard}
        />

        <ModalStackGate
          books={books ?? []}
          categories={categories}
          mainCurrency={mainCurrency}
          preferredCurrencies={preferredCurrencies}
          {...(effectiveTimeZone != null ? { timeZone: effectiveTimeZone } : {})}
        />
      </div>
    </>
  );
}
