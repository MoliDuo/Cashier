/**
 * Centralized Query Key Factory
 *
 * All React Query keys should be defined here to ensure consistency
 * between data fetching and ledger-scoped cache invalidation.
 *
 * Usage:
 *   import { queryKeys } from '@/lib/query-keys';
 *   useQuery({ queryKey: queryKeys.ledgerEntries({ status: 'pending' }), ... })
 */

export const queryKeys = {
  // === Ledger ===
  ledger: () => ["ledger"] as const,

  // === Ledger Entries ===
  ledgerEntries: (params?: QueryKeyParams | null) =>
    ["ledger", "entries", normalizeQueryParams(params)] as const,
  ledgerEntriesPrefix: () => ["ledger", "entries"] as const,

  // === Login emails ===
  /** The addresses that can sign in, so an add or remove shows without a reload. */
  loginEmails: () => ["account", "login-emails"] as const,

  // === Books ===
  /** The switcher's books, so a rename or reorder shows without a fresh page. */
  books: () => ["ledger", "books"] as const,
  /**
   * The same list plus the archived rows. 设置 and the detail page need them,
   * the switcher must not see them, so they are a separate cache entry.
   */
  booksIncludingArchived: () => ["ledger", "books", "including-archived"] as const,
  /** One book by id; the detail page uses it to name a retired book. */
  book: (bookId: string) => ["ledger", "book", bookId] as const,

  // === Source Documents ===
  sourceDocumentStream: (filters?: {
    bookId?: string | null | undefined;
    startDate?: string | null | undefined;
    endDate?: string | null | undefined;
    minAmount?: string | null | undefined;
    maxAmount?: string | null | undefined;
    statuses?: string | null | undefined;
    search?: string | null | undefined;
  }) => ["ledger", "source-documents", "stream", normalizeQueryParams(filters)] as const,
  sourceDocumentStreamPrefix: () => ["ledger", "source-documents", "stream"] as const,
  sourceDocumentStreamTotal: (filters?: {
    bookId?: string | null | undefined;
    startDate?: string | null | undefined;
    endDate?: string | null | undefined;
    minAmount?: string | null | undefined;
    maxAmount?: string | null | undefined;
    statuses?: string | null | undefined;
    search?: string | null | undefined;
  }) => ["ledger", "source-documents", "stream-total", normalizeQueryParams(filters)] as const,
  sourceDocumentStreamTotalPrefix: () => ["ledger", "source-documents", "stream-total"] as const,
  sourceDocument: (documentId: string) =>
    ["ledger", "source-document", documentId, "detail"] as const,
  sourceDocumentDetailPrefix: () => ["ledger", "source-document"] as const,
  sourceDocumentInput: (id: string) => ["ledger", "source-document", id, "input"] as const,
  sourceDocumentRefresh: () => ["ledger", "source-documents", "refresh"] as const,

  // === Categories ===
  entryCategories: () => ["ledger", "categories"] as const,
  categoryReclassification: () => ["ledger", "category-reclassification"] as const,
  categoryAssignmentResults: (jobId: string) =>
    ["ledger", "category-assignment", jobId, "results"] as const,
  ledgerSettings: () => ["ledger", "settings"] as const,

  // === Summary & Stats ===
  summary: (params?: QueryKeyParams | null) =>
    ["ledger", "summary", normalizeQueryParams(params)] as const,
  summaryPrefix: () => ["ledger", "summary"] as const,
  enhancedStats: (params?: {
    bookId?: string | null | undefined;
    startDate?: string | null | undefined;
    endDate?: string | null | undefined;
    compareStartDate?: string | null | undefined;
    compareEndDate?: string | null | undefined;
    rangeType?: string | null | undefined;
    comparisonMode?: string | null | undefined;
    mainCurrency?: string | null | undefined;
  }) => ["ledger", "enhanced-stats", normalizeQueryParams(params)] as const,
  enhancedStatsPrefix: () => ["ledger", "enhanced-stats"] as const,

  // === Currency ===
  convert: (amount: string, from: string, to: string, date: string) =>
    ["ledger", "convert", amount, from, to, date] as const,
} as const;

type QueryKeyParams = Readonly<Record<string, unknown>>;

function normalizeQueryParams(params?: QueryKeyParams | null): Readonly<Record<string, unknown>> {
  if (params == null) return {};
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [key, value === undefined ? null : value])
  );
}
