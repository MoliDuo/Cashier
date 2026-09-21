"use client";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useDrilldownNavigation } from "../hooks/useDrilldownNavigation";
import { useLedgerHistorySync } from "../hooks/useLedgerHistorySync";
import { useLedgerTabs } from "../hooks/useLedgerTabs";
import { usePeriodFilter } from "../hooks/usePeriodFilter";
import { useNewRecordDialogState } from "../hooks/useNewRecordDialogState";
import { useLedgerPageEnvironment } from "../hooks/useLedgerPageEnvironment";
import { useRecordScope } from "../hooks/useRecordScope";
import type { LedgerTab } from "@/lib/ledger-tabs";
import { LedgerQueryErrorBanner } from "@/modules/workspace/ui/LedgerQueryErrorBanner";
import type { EntryCategoryWithCount, LedgerDto } from "@/modules/ledger/contracts";
import type { BookDto } from "@/modules/ledger/contracts";
import { useBooks } from "@/modules/ledger/hooks/useBooks";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { textRoleClassName } from "@/components/typography";
import { LedgerTabPanels } from "./LedgerTabPanels";
import { NewRecordDialog } from "./NewRecordDialog";
import { ModalStackGate } from "./ModalStackGate";
import { CategoryAssignmentProvider } from "@/modules/ledger/ui/CategoryAssignmentProvider";
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
}

function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded bg-surface2", className)} />;
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
}: LedgerPageClientProps) {
  const t = useTranslations("LedgerPage");
  const tCommon = useTranslations("Common");
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

  const { activeTab, handleTabChange: _handleTabChange } = useLedgerTabs({
    initialTab,
    searchParams,
    pathname,
  });
  useLedgerHistorySync({
    pathname,
    searchParams,
    ledgerId,
    legacyScope: activeTab === "details" ? "details" : "stream",
  });

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
    scope: activeTab === "details" ? "details" : "stream",
    ...(effectiveTimeZone != null ? { timeZone: effectiveTimeZone } : {}),
  });

  const advancedFilters = filterParams;
  const { handleCategoryDrilldown, handleDateDrilldown } = useDrilldownNavigation({
    searchParams,
    pathname,
    ledgerId,
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
    pushLedgerUrl(pathname, params, "tab");
  };

  if (ledger == null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <h1 className={textRoleClassName("pageTitle")}>{t("notFound")}</h1>
      </div>
    );
  }

  return (
    <CategoryAssignmentProvider key={ledgerId} ledgerId={ledgerId}>
      <div>
        {/* Every tab refreshes from its own destination in the tab bar, so no
            tab carries a refresh control of its own. Only the active tab is
            mounted — inactive tabs load lazily. */}
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
          onGoToDetails={handleGoToDetails}
        />

        <NewRecordDialog
          scope={recordScope}
          books={books ?? []}
          isOpen={isInputOpen}
          onOpenChange={handleDialogOpenChange}
          isSubmitting={isInputSubmitting}
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
    </CategoryAssignmentProvider>
  );
}
