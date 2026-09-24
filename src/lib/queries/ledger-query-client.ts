import { AppError } from "@/lib/errors";

type QueryActions = {
  detail: typeof import("@/modules/source-document/server/get-document-detail").getSourceDocumentDetailAction;
  stream: (
    input: import("@/modules/source-document/application/queries/list-stream-page").ListStreamPageInput
  ) => Promise<import("@/modules/source-document/contracts").StreamPage>;
  total: (
    input: import("@/modules/source-document/application/queries/get-stream-total").GetStreamTotalInput
  ) => Promise<import("@/modules/source-document/contracts").StreamTotalDto>;
  refresh: (
    input: import("@/modules/source-document/contract-refresh").LedgerRefreshRequest
  ) => Promise<import("@/modules/source-document/contract-refresh").LedgerRefreshResult>;
  /**
   * Listing and totals validate the input they are handed, so the server side of
   * both takes it untyped and the browser is the side that declares its shape.
   */
  entries: (
    input: import("@/modules/ledger/contract-schemas").ListLedgerEntriesInput
  ) => Promise<import("@/modules/ledger/contracts").LedgerEntryPageDto>;
  summary: (
    input: import("@/modules/ledger/contract-schemas").LedgerStatsQueryInput
  ) => Promise<import("@/modules/ledger/contracts").LedgerSummaryDto>;
  ledger: typeof import("@/modules/ledger/server/get-ledger").getLedgerAction;
  /** The three book reads the switcher, 设置 and the detail page use. */
  books: () => Promise<import("@/modules/ledger/contracts").BookDto[]>;
  "books-including-archived": () => Promise<import("@/modules/ledger/contracts").BookDto[]>;
  book: (bookId: string) => Promise<import("@/modules/ledger/contracts").BookDto | null>;
  categories: typeof import("@/modules/ledger/server/list-categories").getEntryCategoriesAction;
  settings: typeof import("@/modules/ledger/server/get-ledger-settings").getLedgerSettingsAction;
  stats: typeof import("@/modules/stats/server/get-enhanced-stats").getEnhancedStats;
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
    if (!response.ok) {
      throw new AppError("Ledger query failed", "LEDGER_QUERY_FAILED", response.status);
    }
    return response.json();
  };
}

export const getSourceDocumentDetailAction = query("detail");
export const listStreamPageAction = query("stream");
export const getStreamTotalAction = query("total");
export const getStreamRefreshAction = query("refresh");
export const getLedgerEntriesAction = query("entries");
export const getLedgerAction = query("ledger");
export const getBooksAction = query("books");
export const getBooksIncludingArchivedAction = query("books-including-archived");
export const getBookAction = query("book");
export const getEntryCategoriesAction = query("categories");
export const getLedgerStatsAction = query("summary");
export const getLedgerSettingsAction = query("settings");
export const getEnhancedStats = query("stats");
export const getCategoryReclassificationJobAction = query("reclassification");
export const getCategoryAssignmentResultsAction = query("category-assignment-results");
