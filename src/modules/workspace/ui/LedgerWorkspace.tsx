"use client";
import { useMemo, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { LedgerTimeZoneProvider } from "@/lib/ledger-time-zone";
import { ledgerTabFromPathname } from "@/lib/ledger-tabs";
import { textRoleClassName } from "@/components/typography";
import { useBooks } from "@/modules/ledger/hooks/useBooks";
import { CategoryAssignmentProvider } from "@/modules/ledger/ui/CategoryAssignmentProvider";
import { useLedgerHistorySync } from "../hooks/useLedgerHistorySync";
import { useLedgerPageEnvironment } from "../hooks/useLedgerPageEnvironment";
import { useRecordScope } from "../hooks/useRecordScope";
import { resolvePeriod } from "@/modules/ledger/domain/period";
import { buildLedgerEntryFilters } from "../ledger-filter-state";
import { readLedgerFilterParams } from "../ledger-url-params";
import { readPeriodParams } from "../period-url-params";
import { useLedgerToday } from "../hooks/useLedgerToday";
import { useLedgerSync } from "../hooks/useLedgerSync";
import { LedgerQueryErrorBanner } from "./LedgerQueryErrorBanner";
import { BookReveal } from "./BookReveal";
import { NewRecordDialog } from "./NewRecordDialog";
import { ModalStackGate } from "./ModalStackGate";
import { LedgerWorkspaceContext, type LedgerWorkspaceValue } from "./ledger-workspace-context";
import { ledgerPageCopy } from "@/copy/app";

interface LedgerWorkspaceProps {
  /** Today in the ledger's zone as the server dated it, so the first render agrees. */
  ledgerToday?: string | undefined;
  children: ReactNode;
}

/** Only before the ledger itself has loaded; the ledger always names its zone. */
const DEFAULT_TIME_ZONE = "Asia/Shanghai";

function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded bg-surface2", className)} />;
}

/**
 * The part of the ledger that outlives a route change: the book scope, the
 * new-record dialog, the detail sheets and the queries every route reads.
 * The route itself arrives as `children`.
 */
export function LedgerWorkspace({ ledgerToday, children }: LedgerWorkspaceProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeTab = ledgerTabFromPathname(pathname);
  const { books } = useBooks({});
  const { recordScope, onRecordScopeChange } = useRecordScope(books);
  useLedgerHistorySync({ activeTab, pathname, searchParams });

  const {
    ledger,
    categoriesQuery,
    categories,
    categoriesHaveNoData,
    mainCurrency,
    preferredCurrencies,
  } = useLedgerPageEnvironment();
  // The one refresh driver: every route below is kept current by this poll.
  useLedgerSync();
  const timeZone = ledger?.settings.timeZone ?? DEFAULT_TIME_ZONE;
  const today = useLedgerToday(timeZone, ledgerToday);

  // A new record is checked against what 流水 is showing, to say when it will
  // not appear there.
  const committedView = useMemo(
    () => ({
      filters: buildLedgerEntryFilters(readLedgerFilterParams(searchParams)),
      range: resolvePeriod(readPeriodParams(searchParams), today),
    }),
    [searchParams, today]
  );

  const value = useMemo<LedgerWorkspaceValue | null>(
    () =>
      ledger == null
        ? null
        : {
            ledger,
            books: books ?? [],
            categories,
            recordScope,
            timeZone,
            today,
          },
    [books, categories, ledger, recordScope, timeZone, today]
  );

  if (value == null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <h1 className={textRoleClassName("pageTitle")}>{ledgerPageCopy.notFound}</h1>
      </div>
    );
  }

  const carriesBookSwitch = activeTab !== "settings" && value.books.length > 0;

  return (
    <LedgerWorkspaceContext.Provider value={value}>
      <LedgerTimeZoneProvider timeZone={timeZone}>
        <CategoryAssignmentProvider>
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

          <div
            className={categoriesHaveNoData ? "hidden" : undefined}
            aria-hidden={categoriesHaveNoData || undefined}
          >
            {carriesBookSwitch ? (
              <BookReveal
                books={value.books}
                scope={recordScope}
                onScopeChange={onRecordScopeChange}
              />
            ) : null}
            <div className="mt-0 min-w-0 max-w-full overflow-x-clip">{children}</div>
          </div>

          <NewRecordDialog
            scope={recordScope}
            books={value.books}
            activeTab={activeTab}
            committedView={committedView}
            categories={categories}
            mainCurrency={mainCurrency}
            preferredCurrencies={preferredCurrencies}
            timeZone={timeZone}
          />

          <ModalStackGate
            books={value.books}
            categories={categories}
            mainCurrency={mainCurrency}
            preferredCurrencies={preferredCurrencies}
            timeZone={timeZone}
          />
        </CategoryAssignmentProvider>
      </LedgerTimeZoneProvider>
    </LedgerWorkspaceContext.Provider>
  );
}
