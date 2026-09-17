import { QueryClient, dehydrate, type DehydratedState } from "@tanstack/react-query";
import { LEDGER } from "@/lib/constants";
import { queryKeys } from "@/lib/query-keys";
import type {
  CategoryPort,
  MemberProfileContract,
  ServiceCredentialPort,
  UserProfilePort,
} from "@/application/contracts";
import type { LedgerDto, EntryCategoryWithCountDto } from "@/modules/ledger/contracts";
import { listEntryCategories } from "@/modules/ledger/application/queries/list-entry-categories";
import { getLedgerSettingsView } from "@/modules/ledger/application/queries/get-ledger-settings-view";
import { getCoupleMembers } from "@/modules/auth/application/queries/get-couple-members";

export interface GetLedgerSettingsBootstrapInput {
  ledgerId: string;
  /** Ledger DTO returned by the authenticated page boundary. */
  ledgerDto: LedgerDto;
}

export interface LedgerSettingsBootstrapResult {
  dehydratedState: DehydratedState;
  initialCategories: EntryCategoryWithCountDto[];
  initialMembers: readonly MemberProfileContract[];
}

export async function getLedgerSettingsBootstrap(
  input: GetLedgerSettingsBootstrapInput,
  dependencies: {
    categories: Pick<CategoryPort, "listWithCount" | "countUncategorized">;
    credentials: Pick<ServiceCredentialPort, "list">;
    profiles: Pick<UserProfilePort, "listMembers">;
  }
): Promise<LedgerSettingsBootstrapResult | null> {
  if (input.ledgerDto.id !== input.ledgerId) return null;
  const ledgerDto = input.ledgerDto;

  const queryClient = new QueryClient();
  queryClient.setQueryData(queryKeys.ledger(input.ledgerId), ledgerDto);

  const members = await getCoupleMembers(dependencies.profiles);
  queryClient.setQueryData(queryKeys.coupleMembers(input.ledgerId), members);

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
    initialMembers: members,
  };
}
