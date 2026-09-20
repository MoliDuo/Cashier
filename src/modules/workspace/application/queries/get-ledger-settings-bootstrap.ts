import { QueryClient, dehydrate, type DehydratedState } from "@tanstack/react-query";
import { LEDGER } from "@/lib/constants";
import { queryKeys } from "@/lib/query-keys";
import type { BookPort, CategoryPort, ServiceCredentialPort } from "@/application/contracts";
import type { BookDto, LedgerDto, EntryCategoryWithCountDto } from "@/modules/ledger/contracts";
import { listEntryCategories } from "@/modules/ledger/application/queries/list-entry-categories";
import { getLedgerSettingsView } from "@/modules/ledger/application/queries/get-ledger-settings-view";
import { listBooks } from "@/modules/ledger/application/queries/list-books";

export interface GetLedgerSettingsBootstrapInput {
  ledgerId: string;
  /** Ledger DTO returned by the authenticated page boundary. */
  ledgerDto: LedgerDto;
}

export interface LedgerSettingsBootstrapResult {
  dehydratedState: DehydratedState;
  initialCategories: EntryCategoryWithCountDto[];
  /** Live books, for the switcher and the API-key pickers. */
  initialBooks: readonly BookDto[];
  /** The same list plus the archived rows, for the 分账 section. */
  initialBooksIncludingArchived: readonly BookDto[];
}

export async function getLedgerSettingsBootstrap(
  input: GetLedgerSettingsBootstrapInput,
  dependencies: {
    categories: Pick<CategoryPort, "listWithCount" | "countUncategorized">;
    credentials: Pick<ServiceCredentialPort, "list">;
    books: Pick<BookPort, "list">;
  }
): Promise<LedgerSettingsBootstrapResult | null> {
  if (input.ledgerDto.id !== input.ledgerId) return null;
  const ledgerDto = input.ledgerDto;

  const queryClient = new QueryClient();
  queryClient.setQueryData(queryKeys.ledger(input.ledgerId), ledgerDto);

  // The three loads below are independent, so they run together rather than one
  // after the other; each joins this chain immediately, so a failure reaches the
  // page boundary instead of being left unhandled.
  const categoriesPromise = queryClient.fetchQuery({
    queryKey: queryKeys.entryCategories(input.ledgerId),
    queryFn: () => listEntryCategories(input.ledgerId, dependencies.categories),
    staleTime: LEDGER.STALE_TIME_MS,
  });
  const booksPromise = listBooks(input.ledgerId, dependencies.books, { includeArchived: true });
  const settingsPromise = queryClient.prefetchQuery({
    queryKey: queryKeys.ledgerSettings(input.ledgerId),
    queryFn: () =>
      getLedgerSettingsView(input.ledgerId, {
        categories: dependencies.categories,
        credentials: dependencies.credentials,
      }),
    staleTime: LEDGER.STALE_TIME_MS,
  });
  const [booksIncludingArchived] = await Promise.all([
    booksPromise,
    categoriesPromise,
    settingsPromise,
  ]);

  // Both views are hydrated: the API-key pickers take the live books, and the
  // 分账 section shows the archived ones alongside them. One read answers both —
  // the switcher's list is this one without its retired rows.
  const books = booksIncludingArchived.filter((book) => book.archivedAt == null);
  queryClient.setQueryData(queryKeys.books(input.ledgerId), books);
  queryClient.setQueryData(
    queryKeys.booksIncludingArchived(input.ledgerId),
    booksIncludingArchived
  );

  return {
    dehydratedState: dehydrate(queryClient),
    initialCategories: await categoriesPromise,
    initialBooks: books,
    initialBooksIncludingArchived: booksIncludingArchived,
  };
}
