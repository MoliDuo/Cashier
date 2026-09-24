import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

export type LedgerInvalidationGroup =
  "documents" | "categories" | "settings" | "stats" | "credentials";

interface LedgerQueryInvalidation {
  queryKey: readonly unknown[];
  exact?: true;
}

function invalidationsForGroup(group: LedgerInvalidationGroup): readonly LedgerQueryInvalidation[] {
  switch (group) {
    case "documents":
      return [
        { queryKey: queryKeys.sourceDocumentStreamPrefix() },
        { queryKey: queryKeys.sourceDocumentStreamTotalPrefix() },
        { queryKey: queryKeys.ledgerEntriesPrefix() },
        { queryKey: queryKeys.sourceDocumentDetailPrefix() },
      ];
    case "categories":
      return [
        { queryKey: queryKeys.entryCategories(), exact: true },
        { queryKey: queryKeys.sourceDocumentStreamPrefix() },
        { queryKey: queryKeys.ledgerEntriesPrefix() },
        { queryKey: queryKeys.sourceDocumentDetailPrefix() },
        { queryKey: queryKeys.summaryPrefix() },
        { queryKey: queryKeys.enhancedStatsPrefix() },
      ];
    case "settings":
      return [
        { queryKey: queryKeys.ledger(), exact: true },
        { queryKey: queryKeys.ledgerSettings(), exact: true },
        { queryKey: queryKeys.summaryPrefix() },
        { queryKey: queryKeys.enhancedStatsPrefix() },
      ];
    case "stats":
      return [
        { queryKey: queryKeys.summaryPrefix() },
        { queryKey: queryKeys.enhancedStatsPrefix() },
        { queryKey: queryKeys.sourceDocumentStreamTotalPrefix() },
      ];
    case "credentials":
      return [{ queryKey: queryKeys.ledgerSettings(), exact: true }];
  }
}

function getLedgerQueryInvalidations(
  groups: readonly LedgerInvalidationGroup[]
): LedgerQueryInvalidation[] {
  const invalidations = new Map<string, LedgerQueryInvalidation>();
  for (const group of groups) {
    for (const invalidation of invalidationsForGroup(group)) {
      const key = JSON.stringify([invalidation.queryKey, invalidation.exact === true]);
      invalidations.set(key, invalidation);
    }
  }
  return [...invalidations.values()];
}

export async function invalidateLedgerQueries(
  queryClient: QueryClient,
  groups: readonly LedgerInvalidationGroup[]
): Promise<void> {
  await Promise.all(
    getLedgerQueryInvalidations(groups).map((filters) =>
      queryClient.invalidateQueries({ ...filters, refetchType: "active" }, { throwOnError: true })
    )
  );
}
