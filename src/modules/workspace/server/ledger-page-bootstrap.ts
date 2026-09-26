import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import {
  QueryClient,
  dehydrate,
  type DehydratedState,
  type InfiniteData,
} from "@tanstack/react-query";
import { runtimeEnv } from "@/lib/env/runtime";
import { logger } from "@/lib/logger";
import { logIdentifier } from "@/lib/security/log-identifier";
import { queryKeys } from "@/lib/query-keys";
import { LEDGER, QUERY } from "@/lib/constants";
import { resolveRequestTimeZone } from "@/lib/time-zone-cookie";
import { calculateLedgerStats } from "@/modules/ledger/server/stats";
import { listLedgerEntries } from "@/modules/ledger/server/list-entries";
import { listCategoriesWithCount } from "@/modules/ledger/server/categories";
import { listBooks } from "@/modules/ledger/server/books";
import { getLedgerSettingsView } from "@/modules/ledger/server/get-ledger-settings";
import { queryEnhancedStats } from "@/modules/stats/server/enhanced-stats-query";
import { listStreamPage } from "@/modules/source-document/server/list-stream-page";
import { getStreamTotal } from "@/modules/source-document/server/stream-total";
import type { StreamPage } from "@/modules/source-document/contracts";
import type { LedgerAdvancedFilters } from "@/modules/workspace/initial-query-state";
import type { PeriodParams } from "@/lib/period-utils";
import type { LedgerTab } from "@/lib/ledger-tabs";
import { addPeriod, getDateInTimezone, isValidTimeZone, parseDateString } from "@/lib/date-utils";
import {
  buildDetailsQueryDescriptor,
  buildStatsQueryDescriptor,
  buildStreamQueryDescriptor,
} from "@/modules/workspace/ledger-tab-query-descriptors";
import type { StatsUrlState } from "@/modules/workspace/stats-url-params";
import { SOURCE_DOC_STALE_TIME_MS } from "@/config/tuning";

import type { BookDto, EntryCategoryWithCount, LedgerDto } from "@/modules/ledger/contracts";
import { DEVICE_TIME_ZONE_COOKIE, parseDeviceTimeZoneCookie } from "@/lib/time-zone-cookie";
import { BOOK_SCOPE_COOKIE, parseBookScopeCookie } from "@/lib/book-scope-cookie";
import {
  resolveAuthenticatedHome,
  type AuthenticatedHomeContext,
} from "./resolve-authenticated-home";

/** A zone is usable when it is present and this runtime can format with it. */
function isUsableTimeZone(timeZone: string | null | undefined): boolean {
  return timeZone != null && timeZone !== "" && isValidTimeZone(timeZone);
}

export interface LedgerViewScope {
  /**
   * The book the page is narrowed to after the live-list check, null for 总账.
   * The remembered scope can name a book that has since been archived or
   * deleted; the live list is the authority, and the server must not prefetch
   * the dead book's records.
   */
  bookId: string | null;
  /** The zone the page is read in, absent until one is known. */
  fixedTimeZone?: string;
  /**
   * Today in that zone, absent when the request named neither a book zone nor
   * a device zone. The date reads are then left to the client, which knows the
   * browser's zone by the time it mounts them.
   */
  ledgerToday?: string;
}

/**
 * The zone the page is read in is the viewed book's; on 总账 it is the device
 * that asked, since no single book owns that view.
 *
 * A page can only be dated once that zone is known. With neither a book zone
 * nor a reported device zone this is the first visit, before the client has
 * written its cookie: dating it by the deployment's zone would prefetch a day
 * (or a month) the tab never asks for, because the tab dates by the device.
 */
export function resolveLedgerViewScope(input: {
  /** The live books, or null when they could not be read. */
  books: readonly BookDto[] | null;
  rememberedBookId: string | null;
  deviceTimeZone: string | null;
}): LedgerViewScope {
  // Without the live list the remembered book cannot be checked, so the page
  // keeps it — losing it would quietly reset the reader to 总账 — and leaves
  // every dated read to the client, which will have the list.
  if (input.books == null) return { bookId: input.rememberedBookId };
  const bookId =
    input.rememberedBookId != null && input.books.some((book) => book.id === input.rememberedBookId)
      ? input.rememberedBookId
      : null;
  const viewedBook =
    bookId == null ? null : (input.books.find((book) => book.id === bookId) ?? null);
  const timeZoneReady =
    isUsableTimeZone(viewedBook?.timeZone) || isUsableTimeZone(input.deviceTimeZone);
  if (!timeZoneReady) return { bookId };
  const fixedTimeZone = resolveRequestTimeZone({
    bookTimeZone: viewedBook?.timeZone,
    deviceTimeZone: input.deviceTimeZone,
    fallbackTimeZone: runtimeEnv.timeZone,
  });
  return {
    bookId,
    fixedTimeZone,
    ledgerToday: getDateInTimezone(fixedTimeZone) ?? getDateInTimezone("UTC")!,
  };
}

export interface LedgerView extends LedgerViewScope {
  context: AuthenticatedHomeContext;
  /** The live books, or null when they could not be read. */
  books: readonly BookDto[] | null;
  /** The book this device's cookie names, before the live-list check. */
  rememberedBookId: string | null;
  deviceTimeZone: string | null;
  /**
   * The categories read, started alongside the books rather than after them.
   * The shell's bootstrap awaits it and handles its failure.
   */
  categories: Promise<EntryCategoryWithCount[]>;
}

/**
 * What every ledger route is rendered against: the session's ledger, its live
 * books, and the book and zone this device reads it in. Cached per request, so
 * the layout and the page share one read.
 */
export const loadLedgerView = cache(async (): Promise<LedgerView> => {
  const context = await resolveAuthenticatedHome();
  const cookieStore = await cookies();
  const rememberedBookId = parseBookScopeCookie(cookieStore.get(BOOK_SCOPE_COOKIE)?.value ?? null);
  const deviceTimeZone = parseDeviceTimeZoneCookie(
    cookieStore.get(DEVICE_TIME_ZONE_COOKIE)?.value ?? null
  );
  const categories = listCategoriesWithCount(context.ledgerId);
  categories.catch(() => {});
  let books: readonly BookDto[] | null;
  try {
    books = await listBooks(context.ledgerId);
  } catch (error) {
    logger.error(
      { error, ledgerSubject: logIdentifier("ledger", context.ledgerId) },
      "Ledger books failed to load; falling back to client queries"
    );
    books = null;
  }
  return {
    context,
    books,
    rememberedBookId,
    deviceTimeZone,
    categories,
    ...resolveLedgerViewScope({ books, rememberedBookId, deviceTimeZone }),
  };
});

/** The ledger, its books and its categories: what the layout's shell renders from. */
export async function getLedgerShellBootstrap(input: {
  ledgerDto: LedgerDto;
  books: readonly BookDto[] | null;
  categories: Promise<EntryCategoryWithCount[]>;
}): Promise<DehydratedState> {
  const queryClient = new QueryClient();
  queryClient.setQueryData(queryKeys.ledger(), input.ledgerDto);
  if (input.books != null) queryClient.setQueryData(queryKeys.books(), input.books);
  queryClient.setQueryData(queryKeys.entryCategories(), await input.categories);
  return dehydrate(queryClient);
}

export interface GetLedgerRouteBootstrapInput {
  tab: LedgerTab;
  ledgerDto: LedgerDto;
  scope: LedgerViewScope;
  periodParams?: PeriodParams;
  advancedFilters?: LedgerAdvancedFilters;
  statsState?: StatsUrlState;
}

/** The first screen of one route, so its HTML arrives filled rather than as a skeleton. */
export async function getLedgerRouteBootstrap(
  input: GetLedgerRouteBootstrapInput
): Promise<DehydratedState> {
  const ledgerId = input.ledgerDto.id;
  const mainCurrency = input.ledgerDto.settings.mainCurrency;
  const { bookId, fixedTimeZone, ledgerToday } = input.scope;
  const queryClient = new QueryClient();

  if (input.tab === "settings") {
    await queryClient.prefetchQuery({
      queryKey: queryKeys.ledgerSettings(),
      queryFn: () => getLedgerSettingsView(ledgerId),
      staleTime: LEDGER.STALE_TIME_MS,
    });
    return dehydrate(queryClient);
  }
  const periodParams: PeriodParams = input.periodParams ?? { period: "thisMonth" };

  const detailsDescriptor =
    ledgerToday == null
      ? null
      : buildDetailsQueryDescriptor({
          ...(bookId == null ? {} : { bookId }),
          periodParams,
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
          ...(bookId == null ? {} : { bookId }),
          startDate: detailsDescriptor.startDateStr,
          endDate: detailsDescriptor.endDateStr,
          minAmount: input.advancedFilters?.minAmount,
          maxAmount: input.advancedFilters?.maxAmount,
          statuses: input.advancedFilters?.statuses,
          search: input.advancedFilters?.search,
        });

  await Promise.all([
    ...(input.tab === "stream" && streamDescriptor != null
      ? [
          // First stream page (all-statuses, filtered by period+amount, paginated)
          queryClient.prefetchInfiniteQuery({
            queryKey: streamDescriptor.queryKey,
            queryFn: async ({ pageParam }) => {
              const pageInput = streamDescriptor.getPageInput(pageParam as string | undefined);
              let page = await listStreamPage(ledgerId, pageInput);
              if (pageParam == null && page.restartRequired) {
                page = await listStreamPage(ledgerId, pageInput);
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
            queryFn: () => getStreamTotal(ledgerId, streamDescriptor.totalInput),
            staleTime: QUERY.DEFAULT_STALE_TIME_MS,
          }),
        ]
      : []),
    ...(input.tab === "details" && detailsDescriptor != null
      ? [
          queryClient.prefetchQuery({
            queryKey: detailsDescriptor.summaryQueryKey,
            queryFn: () => calculateLedgerStats(ledgerId, detailsDescriptor.summaryInput),
            staleTime: QUERY.DEFAULT_STALE_TIME_MS,
          }),
          queryClient.prefetchInfiniteQuery({
            queryKey: detailsDescriptor.entriesQueryKey,
            queryFn: ({ pageParam }) =>
              listLedgerEntries(
                ledgerId,
                detailsDescriptor.getEntriesInput(pageParam as string | undefined)
              ),
            initialPageParam: undefined as string | undefined,
            getNextPageParam: (lastPage: Awaited<ReturnType<typeof listLedgerEntries>>) =>
              lastPage.nextCursor,
            staleTime: QUERY.DEFAULT_STALE_TIME_MS,
          }),
        ]
      : []),
    ...(input.tab === "stats" && statsDescriptor != null
      ? [
          queryClient.prefetchQuery({
            queryKey: statsDescriptor.queryKey,
            queryFn: () => queryEnhancedStats(ledgerId, statsDescriptor.input),
            staleTime: QUERY.DEFAULT_STALE_TIME_MS,
          }),
        ]
      : []),
  ]);
  if (input.tab === "stream" && streamDescriptor != null) {
    const stream = queryClient.getQueryData<InfiniteData<StreamPage>>(streamDescriptor.queryKey);
    const firstPage = stream?.pages[0];
    if (firstPage != null && !firstPage.restartRequired) {
      queryClient.setQueryData(queryKeys.sourceDocumentRefresh(), {
        version: firstPage.generation,
        changed: false,
        hasTransitionalWork: firstPage.hasTransitionalWork,
        invalidations: { categories: false, settings: false, stats: false },
      });
    }
  }
  return dehydrate(queryClient);
}
