import type { QueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";

interface SyncVersion {
  version: string;
}

/** Every ledger query on screen reads again; the ones not mounted wait until they are. */
export function invalidateVisibleLedger(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries(
    { queryKey: queryKeys.ledger(), refetchType: "active" },
    { throwOnError: true }
  );
}

/**
 * After a write, the ledger catches up the way it does for any change: the
 * sync version is read again, and a version that moved invalidates every
 * visible ledger query from inside that read. A write the version does not
 * track — a key, a book — leaves it where it was, so the queries are
 * invalidated here instead. Either way each query reads once.
 */
export async function syncLedgerAfterWrite(queryClient: QueryClient): Promise<void> {
  const syncKey = queryKeys.ledgerSync();
  const before = queryClient.getQueryData<SyncVersion>(syncKey)?.version;
  const observed =
    queryClient.getQueryCache().find({ queryKey: syncKey, exact: true, type: "active" }) != null;
  if (observed) {
    await queryClient.refetchQueries(
      { queryKey: syncKey, exact: true, type: "active" },
      { throwOnError: true }
    );
    const after = queryClient.getQueryData<SyncVersion>(syncKey)?.version;
    if (after != null && after !== before) return;
  }
  await invalidateVisibleLedger(queryClient);
}
