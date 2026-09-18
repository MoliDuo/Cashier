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
  initialBooks: readonly BookDto[];
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

  const books = await listBooks(input.ledgerId, dependencies.books);
  queryClient.setQueryData(queryKeys.books(input.ledgerId), books);

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
  };
}
