type QueryActions = {
  detail: typeof import("@/modules/source-document/server/get-document-light").getSourceDocumentLightAction;
  stream: (
    ledgerId: string,
    input: import("@/modules/source-document/application/queries/list-stream-page").ListStreamPageInput
  ) => Promise<import("@/modules/source-document/contracts").StreamPage>;
  total: (
    ledgerId: string,
    input: import("@/modules/source-document/application/queries/get-stream-total").GetStreamTotalInput
  ) => Promise<import("@/modules/source-document/contracts").StreamTotalDto>;
  refresh: (
    ledgerId: string,
    input: import("@/modules/source-document/contract-refresh").LedgerRefreshRequest
  ) => Promise<import("@/modules/source-document/contract-refresh").LedgerRefreshResult>;
  entries: typeof import("@/modules/ledger/server/list-entries").getLedgerEntriesAction;
  summary: typeof import("@/modules/ledger/server/stats").getLedgerStatsAction;
  stats: typeof import("@/modules/stats/server/get-enhanced-stats").getEnhancedStats;
  "book-totals": typeof import("@/modules/stats/server/get-book-totals").getBookTotals;
  reclassification: typeof import("@/modules/ledger/server/get-category-reclassification-job").getCategoryReclassificationJobAction;
  "category-assignment-results": typeof import("@/modules/ledger/server/get-category-reclassification-job").getCategoryAssignmentResultsAction;
};

function query<K extends keyof QueryActions>(name: K) {
  return async (
    ...args: Parameters<QueryActions[K]>
  ): Promise<Awaited<ReturnType<QueryActions[K]>>> => {
    const response = await fetch("/api/ledger-queries", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: name, args }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`LEDGER_QUERY_FAILED_${response.status}`);
    return response.json();
  };
}

export const getSourceDocumentLightAction = query("detail");
export const listStreamPageAction = query("stream");
export const getStreamTotalAction = query("total");
export const getStreamRefreshAction = query("refresh");
export const getLedgerEntriesAction = query("entries");
export const getLedgerStatsAction = query("summary");
export const getEnhancedStats = query("stats");
export const getBookTotals = query("book-totals");
export const getCategoryReclassificationJobAction = query("reclassification");
export const getCategoryAssignmentResultsAction = query("category-assignment-results");
