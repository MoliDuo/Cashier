import {
  QueryClient,
  dehydrate,
  type DehydratedState,
  type InfiniteData,
} from "@tanstack/react-query";
import { runtimeEnv } from "@/lib/env/runtime";
import { queryKeys } from "@/lib/query-keys";
import { LEDGER, QUERY } from "@/lib/constants";
import { resolveRequestTimeZone } from "@/lib/time-zone-cookie";
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
import { addPeriod, getDateInTimezone, isValidTimeZone, parseDateString } from "@/lib/date-utils";
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
import { SOURCE_DOC_STALE_TIME_MS } from "@/config/tuning";

interface LedgerPageBootstrapResult {
  dehydratedState: DehydratedState;
  /**
   * Today in the zone the page is read in, absent when the request named neither
   * a book zone nor a device zone. The date reads are then left to the client,
   * which knows the browser's zone by the time it mounts them.
   */
  ledgerToday?: string;
  initialCategories: EntryCategoryWithCountDto[];
  initialBooks: readonly BookDto[];
  /**
   * The book the page is narrowed to after the live-list check, null for 总账.
   * The client seeds its scope memory with it, so the first paint already shows
   * the same book the prefetch filled.
   */
  initialBookId: string | null;
}

/** A zone is usable when it is present and this runtime can format with it. */
function isUsableTimeZone(timeZone: string | null | undefined): boolean {
  return timeZone != null && timeZone !== "" && isValidTimeZone(timeZone);
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
  /**
   * The device zone the browser reported, when it has done so. A null book zone
   * dates by this before falling back to the deployment's `TZ`.
   */
  deviceTimeZone?: string | null;
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
  // The categories and the settings view do not depend on the viewed book, so
  // they start here: only the date-scoped reads below have to wait for it. Each
  // promise joins this chain immediately, so a failure is reported by the page
  // boundary rather than left unhandled.
  const categoriesPromise = queryClient.fetchQuery({
    queryKey: queryKeys.entryCategories(input.ledgerId),
    queryFn: () => listEntryCategories(input.ledgerId, dependencies.categories),
    staleTime: LEDGER.STALE_TIME_MS,
  });
  const settingsPromise =
    input.initialTab === "settings"
      ? queryClient.prefetchQuery({
          queryKey: queryKeys.ledgerSettings(input.ledgerId),
          queryFn: () =>
            getLedgerSettingsView(input.ledgerId, {
              categories: dependencies.categories,
              credentials: dependencies.credentials,
            }),
          staleTime: LEDGER.STALE_TIME_MS,
        })
      : Promise.resolve();
  const booksPromise = dependencies.books
    .list(input.ledgerId)
    .then((rows) => rows.map(toBookDto))
    .then((books) => {
      queryClient.setQueryData(queryKeys.books(input.ledgerId), books);
      return books;
    });
  const [books] = await Promise.all([booksPromise, categoriesPromise, settingsPromise]);
  // The remembered scope can name a book that has since been archived or
  // deleted. The live list is the authority: the scope resets to 总账 on the
  // client, and the server must not prefetch the dead book's records in the
  // meantime.
  const bookId =
    input.bookId != null && books.some((book) => book.id === input.bookId) ? input.bookId : null;
  const viewedBook = bookId == null ? null : (books.find((book) => book.id === bookId) ?? null);
  // The zone the page is read in is the viewed book's; on 总账 it is the device
  // that asked, since no single book owns that view.
  //
  // A page can only be dated once that zone is known. With neither a book zone
  // nor a reported device zone this is the first visit, before the client has
  // written its cookie: dating it by the deployment's zone would prefetch a day
  // (or a month) the tab never asks for, because the tab dates by the device.
  // The date reads below wait for the browser to answer; the ledger, books,
  // categories and settings loads do not.
  const timeZoneReady =
    isUsableTimeZone(viewedBook?.timeZone) || isUsableTimeZone(input.deviceTimeZone);
  const fixedTimeZone = timeZoneReady
    ? resolveRequestTimeZone({
        bookTimeZone: viewedBook?.timeZone,
        deviceTimeZone: input.deviceTimeZone,
        fallbackTimeZone: runtimeEnv.timeZone,
      })
    : undefined;
  const ledgerToday = timeZoneReady
    ? (getDateInTimezone(fixedTimeZone) ?? getDateInTimezone("UTC"))
    : undefined;
  const detailsDescriptor =
    ledgerToday == null
      ? null
      : buildDetailsQueryDescriptor({
          ledgerId: input.ledgerId,
          ...(bookId == null ? {} : { bookId }),
          periodParams: input.periodParams,
          ...(input.advancedFilters !== undefined
            ? { advancedFilters: input.advancedFilters }
            : {}),
          ...(fixedTimeZone !== undefined ? { timeZone: fixedTimeZone } : {}),
          mainCurrency,
        });
  const statsDescriptor =
    ledgerToday == null
      ? null
      : buildStatsQueryDescriptor({
          ledgerId: input.ledgerId,
          ...(bookId == null ? {} : { bookId }),
          currentDate:
            input.statsState == null
              ? parseDateString(ledgerToday)
              : addPeriod(
                  parseDateString(ledgerToday),
                  input.statsState.range,
                  input.statsState.offset
                ),
          mainCurrency,
          ...(input.statsState != null ? { rangeType: input.statsState.range } : {}),
          ...(input.statsState != null ? { currentPeriod: input.statsState.offset === 0 } : {}),
        });
  const streamDescriptor =
    detailsDescriptor == null
      ? null
      : buildStreamQueryDescriptor({
          ledgerId: input.ledgerId,
          ...(bookId == null ? {} : { bookId }),
          startDate: detailsDescriptor.startDateStr,
          endDate: detailsDescriptor.endDateStr,
          minAmount: input.advancedFilters?.minAmount,
          maxAmount: input.advancedFilters?.maxAmount,
          statuses: input.advancedFilters?.statuses,
          search: input.advancedFilters?.search,
        });

  await Promise.all([
    ...(input.initialTab === "stream" && streamDescriptor != null
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
            staleTime: SOURCE_DOC_STALE_TIME_MS,
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
    ...(input.initialTab === "details" && detailsDescriptor != null
      ? [
          queryClient.prefetchQuery({
            queryKey: detailsDescriptor.summaryQueryKey,
            queryFn: () =>
              calculateLedgerStats(
                input.ledgerId,
                detailsDescriptor.summaryInput,
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
    ...(input.initialTab === "stats" && statsDescriptor != null
      ? [
          queryClient.prefetchQuery({
            queryKey: statsDescriptor.queryKey,
            queryFn: () => getEnhancedStats(statsDescriptor.input, dependencies.stats),
            staleTime: QUERY.DEFAULT_STALE_TIME_MS,
          }),
        ]
      : []),
  ]);
  if (input.initialTab === "stream" && streamDescriptor != null) {
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
    ...(ledgerToday != null ? { ledgerToday } : {}),
    initialCategories,
    initialBooks: books,
    initialBookId: bookId,
  };
}
