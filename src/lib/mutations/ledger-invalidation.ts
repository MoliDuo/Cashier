import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

export type LedgerInvalidationGroup =
  "documents" | "categories" | "settings" | "stats" | "credentials";

interface LedgerQueryInvalidation {
  queryKey: readonly unknown[];
  exact?: true;
}

function invalidationsForGroup(
  ledgerId: string,
  group: LedgerInvalidationGroup
): readonly LedgerQueryInvalidation[] {
  switch (group) {
    case "documents":
      return [
        { queryKey: queryKeys.sourceDocumentStreamPrefix(ledgerId) },
        { queryKey: queryKeys.sourceDocumentStreamTotalPrefix(ledgerId) },
        { queryKey: queryKeys.ledgerEntriesPrefix(ledgerId) },
        { queryKey: queryKeys.sourceDocumentDetailPrefix(ledgerId) },
      ];
    case "categories":
      return [
        { queryKey: queryKeys.entryCategories(ledgerId), exact: true },
        { queryKey: queryKeys.sourceDocumentStreamPrefix(ledgerId) },
        { queryKey: queryKeys.ledgerEntriesPrefix(ledgerId) },
        { queryKey: queryKeys.sourceDocumentDetailPrefix(ledgerId) },
        { queryKey: queryKeys.summaryPrefix(ledgerId) },
        { queryKey: queryKeys.enhancedStatsPrefix(ledgerId) },
      ];
    case "settings":
      return [
        { queryKey: queryKeys.ledger(ledgerId), exact: true },
        { queryKey: queryKeys.ledgerSettings(ledgerId), exact: true },
        { queryKey: queryKeys.summaryPrefix(ledgerId) },
        { queryKey: queryKeys.enhancedStatsPrefix(ledgerId) },
      ];
    case "stats":
      return [
        { queryKey: queryKeys.summaryPrefix(ledgerId) },
        { queryKey: queryKeys.enhancedStatsPrefix(ledgerId) },
        { queryKey: queryKeys.sourceDocumentStreamTotalPrefix(ledgerId) },
      ];
    case "credentials":
      return [{ queryKey: queryKeys.ledgerSettings(ledgerId), exact: true }];
  }
}

function getLedgerQueryInvalidations(
  ledgerId: string,
  groups: readonly LedgerInvalidationGroup[]
): LedgerQueryInvalidation[] {
  const invalidations = new Map<string, LedgerQueryInvalidation>();
  for (const group of groups) {
    for (const invalidation of invalidationsForGroup(ledgerId, group)) {
      const key = JSON.stringify([invalidation.queryKey, invalidation.exact === true]);
      invalidations.set(key, invalidation);
    }
  }
  return [...invalidations.values()];
}

export async function invalidateLedgerQueries(
  queryClient: QueryClient,
  ledgerId: string,
  groups: readonly LedgerInvalidationGroup[]
): Promise<void> {
  await Promise.all(
    getLedgerQueryInvalidations(ledgerId, groups).map((filters) =>
      queryClient.invalidateQueries({ ...filters, refetchType: "active" }, { throwOnError: true })
    )
  );
}
