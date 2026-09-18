import {
  QueryClient,
  dehydrate,
  type DehydratedState,
  type InfiniteData,
} from "@tanstack/react-query";
import { runtimeEnv } from "@/lib/env/runtime";
import { queryKeys } from "@/lib/query-keys";
import { LEDGER, QUERY } from "@/lib/constants";
import { calculateLedgerStats } from "@/modules/ledger/application/queries/calculate-ledger-stats";
import { listEntryCategories } from "@/modules/ledger/application/queries/list-entry-categories";
import { listLedgerEntries } from "@/modules/ledger/application/queries/list-ledger-entries";
import { getEnhancedStats } from "@/modules/stats/application/queries/get-enhanced-stats";
import { listStreamPage } from "@/modules/source-document/application/queries/list-stream-page";
import { getStreamTotal } from "@/modules/source-document/application/queries/get-stream-total";
import type { StreamPage } from "@/modules/source-document/contracts";
import type { LedgerAdvancedFilters } from "@/modules/workspace/initial-query-state";
import type { PeriodParams } from "@/lib/period-utils";
import type { LedgerDto } from "@/modules/ledger/contracts";
import type { LedgerTab } from "@/lib/ledger-tabs";
import { addPeriod, getDateInTimezone, parseDateString } from "@/lib/date-utils";
import type { CategoryPort } from "@/application/contracts";
import type { ServiceCredentialPort } from "@/application/contracts";
import type { BookDto } from "@/modules/ledger/contracts";
import type { BookPort } from "@/application/contracts";
import type { LedgerReadPort } from "@/modules/ledger/application/ports";
import type { StatsReadPort } from "@/modules/stats/application/ports";
import type {
  LedgerChangeReadPort,
  SourceDocumentReadPort,
} from "@/modules/source-document/application/ports";
import { getLedgerSettingsView } from "@/modules/ledger/application/queries/get-ledger-settings-view";
import { toBookDto } from "@/modules/ledger/application/queries/list-books";
import type { EntryCategoryWithCountDto } from "@/modules/ledger/contracts";
import {
  buildDetailsQueryDescriptor,
  buildStatsQueryDescriptor,
  buildStreamQueryDescriptor,
} from "@/modules/workspace/ledger-tab-query-descriptors";
import type { StatsUrlState } from "@/modules/workspace/ledger-url-params";

interface LedgerPageBootstrapResult {
  dehydratedState: DehydratedState;
  ledgerToday: string;
  initialCategories: EntryCategoryWithCountDto[];
  initialBooks: readonly BookDto[];
}

export interface GetLedgerPageBootstrapInput {
  ledgerId: string;
  initialTab: LedgerTab;
  periodParams: PeriodParams;
  advancedFilters?: LedgerAdvancedFilters;
  statsState?: StatsUrlState;
  /** Ledger DTO returned by the authenticated page boundary. */
  ledgerDto: LedgerDto;
  /** The book being viewed, or null for 总账. */
  bookId?: string | null;
}

export async function getLedgerPageBootstrap(
  input: GetLedgerPageBootstrapInput,
  dependencies: {
    categories: Pick<CategoryPort, "listWithCount" | "countUncategorized">;
    books: Pick<BookPort, "list">;
    ledgerReads: Pick<
      LedgerReadPort,
      "calculateStats" | "listEntries" | "listEntriesBySourceDocumentIds"
    >;
    stats: Pick<StatsReadPort, "queryEnhanced">;
    sourceDocuments: {
      documents: Pick<SourceDocumentReadPort, "list" | "calculateCompletedTotal">;
      ledgerReads: Pick<LedgerReadPort, "listEntriesBySourceDocumentIds">;
      changes: Pick<LedgerChangeReadPort, "getVersion" | "getRefreshBaseline">;
    };
    credentials: Pick<ServiceCredentialPort, "list">;
  }
): Promise<LedgerPageBootstrapResult | null> {
  if (input.ledgerDto.id !== input.ledgerId) return null;
  const ledgerDto = input.ledgerDto;

  const queryClient = new QueryClient();
  queryClient.setQueryData(queryKeys.ledger(input.ledgerId), ledgerDto);

  const mainCurrency = ledgerDto.settings.mainCurrency;
  // The zone the page is read in is the viewed book's; 总账 uses the default
  // book's zone, because "today" has to be one day even when the books differ.
  const books = (await dependencies.books.list(input.ledgerId)).map(toBookDto);
  queryClient.setQueryData(queryKeys.books(input.ledgerId), books);
  const viewedBook =
    books.find((book) => book.id === input.bookId) ??
    books.find((book) => book.isDefault) ??
    books[0] ??
    null;
  const fixedTimeZone = viewedBook?.timeZone ?? runtimeEnv.timeZone;
  const zonedToday = getDateInTimezone(fixedTimeZone);
  const ledgerToday = zonedToday ?? getDateInTimezone("UTC")!;
  const initialStatsDate = parseDateString(ledgerToday);
  const detailsDescriptor = buildDetailsQueryDescriptor({
    ledgerId: input.ledgerId,
    ...(input.bookId == null ? {} : { bookId: input.bookId }),
    periodParams: input.periodParams,
    ...(input.advancedFilters !== undefined ? { advancedFilters: input.advancedFilters } : {}),
    ...(fixedTimeZone !== undefined ? { timeZone: fixedTimeZone } : {}),
    mainCurrency,
  });
  const statsDescriptor = buildStatsQueryDescriptor({
    ledgerId: input.ledgerId,
    currentDate:
      input.statsState == null
        ? initialStatsDate
        : addPeriod(initialStatsDate, input.statsState.range, input.statsState.offset),
    mainCurrency,
    ...(input.statsState != null ? { rangeType: input.statsState.range } : {}),
    ...(input.statsState != null ? { currentPeriod: input.statsState.offset === 0 } : {}),
  });
  const streamDescriptor = buildStreamQueryDescriptor({
    ledgerId: input.ledgerId,
    ...(input.bookId == null ? {} : { bookId: input.bookId }),
    startDate: detailsDescriptor.startDateStr,
    endDate: detailsDescriptor.endDateStr,
    minAmount: input.advancedFilters?.minAmount,
    maxAmount: input.advancedFilters?.maxAmount,
    statuses: input.advancedFilters?.statuses,
    search: input.advancedFilters?.search,
  });

  const categoriesPromise = queryClient.fetchQuery({
    queryKey: queryKeys.entryCategories(input.ledgerId),
    queryFn: () => listEntryCategories(input.ledgerId, dependencies.categories),
    staleTime: LEDGER.STALE_TIME_MS,
  });
  await Promise.all([
    ...(input.initialTab === "stream"
      ? [
          // First stream page (all-statuses, filtered by period+amount, paginated)
          queryClient.prefetchInfiniteQuery({
            queryKey: streamDescriptor.queryKey,
            queryFn: async ({ pageParam }) => {
              const pageInput = streamDescriptor.getPageInput(pageParam as string | undefined);
              let page = await listStreamPage(
                input.ledgerId,
                pageInput,
                dependencies.sourceDocuments
              );
              if (pageParam == null && page.restartRequired) {
                page = await listStreamPage(
                  input.ledgerId,
                  pageInput,
                  dependencies.sourceDocuments
                );
                if (page.restartRequired) {
                  throw new Error("Stream restart did not produce a valid first page");
                }
              }
              return page;
            },
            initialPageParam: undefined as string | undefined,
            getNextPageParam: (lastPage: StreamPage) => lastPage.nextCursor,
            staleTime: runtimeEnv.sourceDocStaleTimeMs,
          }),
          queryClient.prefetchQuery({
            queryKey: streamDescriptor.totalQueryKey,
            queryFn: () =>
              getStreamTotal(
                input.ledgerId,
                streamDescriptor.totalInput,
                dependencies.sourceDocuments.documents
              ),
            staleTime: QUERY.DEFAULT_STALE_TIME_MS,
          }),
        ]
      : []),
    ...(input.initialTab === "details"
      ? [
          queryClient.prefetchQuery({
            queryKey: detailsDescriptor.summaryQueryKey,
            queryFn: () =>
              calculateLedgerStats(
                input.ledgerId,
                {
                  ...detailsDescriptor.summaryParams.filters,
                  ...(detailsDescriptor.summaryParams.startDate != null
                    ? { startDate: detailsDescriptor.summaryParams.startDate }
                    : {}),
                  ...(detailsDescriptor.summaryParams.endDate != null
                    ? { endDate: detailsDescriptor.summaryParams.endDate }
                    : {}),
                },
                dependencies.ledgerReads
              ),
            staleTime: QUERY.DEFAULT_STALE_TIME_MS,
          }),
          queryClient.prefetchInfiniteQuery({
            queryKey: detailsDescriptor.entriesQueryKey,
            queryFn: ({ pageParam }) =>
              listLedgerEntries(
                input.ledgerId,
                detailsDescriptor.getEntriesInput(pageParam as string | undefined),
                dependencies.ledgerReads
              ),
            initialPageParam: undefined as string | undefined,
            getNextPageParam: (lastPage: Awaited<ReturnType<typeof listLedgerEntries>>) =>
              lastPage.nextCursor,
            staleTime: QUERY.DEFAULT_STALE_TIME_MS,
          }),
        ]
      : []),
    ...(input.initialTab === "stats"
      ? [
          queryClient.prefetchQuery({
            queryKey: statsDescriptor.queryKey,
            queryFn: () => getEnhancedStats(statsDescriptor.input, dependencies.stats),
            staleTime: QUERY.DEFAULT_STALE_TIME_MS,
          }),
        ]
      : []),
    ...(input.initialTab === "settings"
      ? [
          queryClient.prefetchQuery({
            queryKey: queryKeys.ledgerSettings(input.ledgerId),
            queryFn: () =>
              getLedgerSettingsView(input.ledgerId, {
                categories: dependencies.categories,
                credentials: dependencies.credentials,
              }),
            staleTime: LEDGER.STALE_TIME_MS,
          }),
        ]
      : []),
    categoriesPromise,
  ]);
  if (input.initialTab === "stream") {
    const stream = queryClient.getQueryData<InfiniteData<StreamPage>>(streamDescriptor.queryKey);
    const firstPage = stream?.pages[0];
    if (firstPage != null && !firstPage.restartRequired) {
      queryClient.setQueryData(queryKeys.sourceDocumentRefresh(input.ledgerId), {
        version: firstPage.generation,
        changed: false,
        hasTransitionalWork: firstPage.hasTransitionalWork,
        invalidations: { categories: false, settings: false, stats: false },
      });
    }
  }
  const initialCategories = await categoriesPromise;

  return {
    dehydratedState: dehydrate(queryClient),
    ledgerToday,
    initialCategories,
    initialBooks: books,
  };
}
