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

  // Both views are hydrated: the API-key pickers take the live books, and the
  // 分账 section shows the archived ones alongside them.
  const books = await listBooks(input.ledgerId, dependencies.books);
  const booksIncludingArchived = await listBooks(input.ledgerId, dependencies.books, {
    includeArchived: true,
  });
  queryClient.setQueryData(queryKeys.books(input.ledgerId), books);
  queryClient.setQueryData(
    queryKeys.booksIncludingArchived(input.ledgerId),
    booksIncludingArchived
  );

  const categoriesPromise = queryClient.fetchQuery({
    queryKey: queryKeys.entryCategories(input.ledgerId),
    queryFn: () => listEntryCategories(input.ledgerId, dependencies.categories),
    staleTime: LEDGER.STALE_TIME_MS,
  });
  await Promise.all([
    categoriesPromise,
    queryClient.prefetchQuery({
      queryKey: queryKeys.ledgerSettings(input.ledgerId),
      queryFn: () =>
        getLedgerSettingsView(input.ledgerId, {
          categories: dependencies.categories,
          credentials: dependencies.credentials,
        }),
      staleTime: LEDGER.STALE_TIME_MS,
    }),
  ]);

  return {
    dehydratedState: dehydrate(queryClient),
    initialCategories: await categoriesPromise,
    initialBooks: books,
    initialBooksIncludingArchived: booksIncludingArchived,
  };
}
