import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import {
  QueryClient,
  dehydrate,
  type DehydratedState,
  type InfiniteData,
} from "@tanstack/react-query";
import { logger } from "@/lib/logger";
import { logIdentifier } from "@/lib/security/log-identifier";
import { queryKeys } from "@/lib/query-keys";
import { LEDGER, QUERY } from "@/lib/constants";
import { calculateLedgerStats } from "@/modules/ledger/server/stats";
import { listLedgerEntries } from "@/modules/ledger/server/list-entries";
import { listCategoriesWithCount } from "@/modules/ledger/server/categories";
import { listBooks } from "@/modules/ledger/server/books";
import { getLedgerSettingsView } from "@/modules/ledger/server/get-ledger-settings";
import {
  findEarliestEffectiveDate,
  queryEnhancedStats,
} from "@/modules/stats/server/enhanced-stats-query";
import { parseEnhancedStatsInput } from "@/modules/stats/contract-schemas";
import {
  ledgerToday,
  withResolvedPeriod,
  withResolvedStatsPeriod,
} from "@/modules/ledger/server/query-period";
import { DEFAULT_PERIOD, type Period } from "@/modules/ledger/domain/period";
import { listStreamPage } from "@/modules/source-document/server/list-stream-page";
import { getStreamTotal } from "@/modules/source-document/server/stream-total";
import type { StreamPage } from "@/modules/source-document/contracts";
import {
  streamPageInputSchema,
  streamTotalInputSchema,
} from "@/modules/source-document/contract-schemas";
import { omitUndefinedProperties } from "@/lib/validation";
import type { LedgerAdvancedFilters } from "@/modules/ledger/ledger-query";
import type { LedgerPage } from "@/lib/ledger-tabs";
import {
  buildDetailsQueryDescriptor,
  buildStatsQueryDescriptor,
  buildStreamQueryDescriptor,
} from "@/modules/workspace/ledger-tab-query-descriptors";
import { SOURCE_DOC_STALE_TIME_MS } from "@/config/tuning";

import type { BookDto, EntryCategoryWithCount, LedgerDto } from "@/modules/ledger/contracts";
import { BOOK_SCOPE_COOKIE, parseBookScopeCookie } from "@/lib/book-scope-cookie";
import {
  resolveAuthenticatedHome,
  type AuthenticatedHomeContext,
} from "./resolve-authenticated-home";

export interface LedgerViewScope {
  /**
   * The book the page is narrowed to after the live-list check, null for 总账.
   * The remembered scope can name a book that has since been archived or
   * deleted; the live list is the authority, and the server must not prefetch
   * the dead book's records.
   */
  bookId: string | null;
}

/**
 * The book a page is read in: the one this device remembered, while it is
 * still live. Without the live list the remembered book cannot be checked, so
 * the page keeps it — losing it would quietly reset the reader to 总账.
 */
export function resolveLedgerViewScope(input: {
  /** The live books, or null when they could not be read. */
  books: readonly BookDto[] | null;
  rememberedBookId: string | null;
}): LedgerViewScope {
  if (input.books == null) return { bookId: input.rememberedBookId };
  const live =
    input.rememberedBookId != null &&
    input.books.some((book) => book.id === input.rememberedBookId);
  return { bookId: live ? input.rememberedBookId : null };
}

export interface LedgerView extends LedgerViewScope {
  context: AuthenticatedHomeContext;
  /** The live books, or null when they could not be read. */
  books: readonly BookDto[] | null;
  /** The book this device's cookie names, before the live-list check. */
  rememberedBookId: string | null;
  /** Today in the ledger's zone, so the first render and the prefetch agree. */
  ledgerToday: string;
  /**
   * The categories read, started alongside the books rather than after them.
   * The shell's bootstrap awaits it and handles its failure.
   */
  categories: Promise<EntryCategoryWithCount[]>;
}

/**
 * What every ledger route is rendered against: the session's ledger, its live
 * books, the book this device reads it in, and the ledger's today. Cached per
 * request, so the layout and the page share one read.
 */
export const loadLedgerView = cache(async (): Promise<LedgerView> => {
  const context = await resolveAuthenticatedHome();
  const cookieStore = await cookies();
  const rememberedBookId = parseBookScopeCookie(cookieStore.get(BOOK_SCOPE_COOKIE)?.value ?? null);
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
    ledgerToday: ledgerToday(context.ledgerDto.settings.timeZone),
    categories,
    ...resolveLedgerViewScope({ books, rememberedBookId }),
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
  page: LedgerPage;
  ledgerDto: LedgerDto;
  scope: LedgerViewScope;
  period?: Period;
  advancedFilters?: LedgerAdvancedFilters;
}

/**
 * The first screen of one route, so its HTML arrives filled rather than as a
 * skeleton. The keys name the period and the reads resolve it exactly as the
 * browser's own reads are resolved, so the cache it fills is the one the tab
 * mounts.
 */
export async function getLedgerRouteBootstrap(
  input: GetLedgerRouteBootstrapInput
): Promise<DehydratedState> {
  const ledgerId = input.ledgerDto.id;
  const { mainCurrency, timeZone } = input.ledgerDto.settings;
  const { bookId } = input.scope;
  const period = input.period ?? DEFAULT_PERIOD;
  const queryClient = new QueryClient();

  if (input.page === "settings") {
    await queryClient.prefetchQuery({
      queryKey: queryKeys.ledgerSettings(),
      queryFn: () => getLedgerSettingsView(ledgerId),
      staleTime: LEDGER.STALE_TIME_MS,
    });
    return dehydrate(queryClient);
  }

  if (input.page === "documents") {
    const descriptor = buildStreamQueryDescriptor({
      ...(bookId == null ? {} : { bookId }),
      period,
      minAmount: input.advancedFilters?.minAmount,
      maxAmount: input.advancedFilters?.maxAmount,
      statuses: input.advancedFilters?.statuses,
      search: input.advancedFilters?.search,
    });
    await Promise.all([
      queryClient.prefetchInfiniteQuery({
        queryKey: descriptor.queryKey,
        queryFn: async ({ pageParam }) => {
          const parsed = streamPageInputSchema.parse(
            withResolvedPeriod(descriptor.getPageInput(pageParam as string | undefined), timeZone)
          );
          const pageInput = { ...omitUndefinedProperties(parsed), limit: parsed.limit };
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
        queryKey: descriptor.totalQueryKey,
        queryFn: () =>
          getStreamTotal(
            ledgerId,
            omitUndefinedProperties(
              streamTotalInputSchema.parse(withResolvedPeriod(descriptor.totalInput, timeZone))
            )
          ),
        staleTime: QUERY.DEFAULT_STALE_TIME_MS,
      }),
    ]);
    const stream = queryClient.getQueryData<InfiniteData<StreamPage>>(descriptor.queryKey);
    const firstPage = stream?.pages[0];
    if (firstPage != null && !firstPage.restartRequired) {
      queryClient.setQueryData(queryKeys.ledgerSync(), {
        version: firstPage.generation,
        changed: false,
        hasTransitionalWork: firstPage.hasTransitionalWork,
        invalidations: { categories: false, settings: false, stats: false },
      });
    }
    return dehydrate(queryClient);
  }

  if (input.page === "entries") {
    const descriptor = buildDetailsQueryDescriptor({
      ...(bookId == null ? {} : { bookId }),
      period,
      ...(input.advancedFilters !== undefined ? { advancedFilters: input.advancedFilters } : {}),
      mainCurrency,
    });
    await Promise.all([
      queryClient.prefetchQuery({
        queryKey: descriptor.summaryQueryKey,
        queryFn: () =>
          calculateLedgerStats(ledgerId, withResolvedPeriod(descriptor.summaryInput, timeZone)),
        staleTime: QUERY.DEFAULT_STALE_TIME_MS,
      }),
      queryClient.prefetchInfiniteQuery({
        queryKey: descriptor.entriesQueryKey,
        queryFn: ({ pageParam }) =>
          listLedgerEntries(
            ledgerId,
            withResolvedPeriod(
              descriptor.getEntriesInput(pageParam as string | undefined),
              timeZone
            )
          ),
        initialPageParam: undefined as string | undefined,
        getNextPageParam: (lastPage: Awaited<ReturnType<typeof listLedgerEntries>>) =>
          lastPage.nextCursor,
        staleTime: QUERY.DEFAULT_STALE_TIME_MS,
      }),
    ]);
    return dehydrate(queryClient);
  }

  const descriptor = buildStatsQueryDescriptor({
    ...(bookId == null ? {} : { bookId }),
    period,
    mainCurrency,
  });
  await queryClient.prefetchQuery({
    queryKey: descriptor.queryKey,
    queryFn: async () =>
      queryEnhancedStats(
        ledgerId,
        parseEnhancedStatsInput(
          await withResolvedStatsPeriod(descriptor.input, timeZone, (scopeBookId) =>
            findEarliestEffectiveDate(ledgerId, scopeBookId)
          )
        )
      ),
    staleTime: QUERY.DEFAULT_STALE_TIME_MS,
  });
  return dehydrate(queryClient);
}
