/**
 * Centralized Query Key Factory
 *
 * All React Query keys should be defined here to ensure consistency
 * between data fetching and ledger-scoped cache invalidation.
 *
 * Usage:
 *   import { queryKeys } from '@/lib/query-keys';
 *   useQuery({ queryKey: queryKeys.ledgerEntries(ledgerId, { status: 'pending' }), ... })
 */

export const queryKeys = {
  // === Ledger ===
  ledger: (ledgerId: string) => ["ledger", ledgerId] as const,

  // === Ledger Entries ===
  ledgerEntries: (ledgerId: string, params?: QueryKeyParams | null) =>
    ["ledger", ledgerId, "entries", normalizeQueryParams(params)] as const,
  ledgerEntriesPrefix: (ledgerId: string) => ["ledger", ledgerId, "entries"] as const,

  // === Login emails ===
  /** The addresses that can sign in, so an add or remove shows without a reload. */
  loginEmails: () => ["account", "login-emails"] as const,

  // === Books ===
  /** The switcher's books, so a rename or reorder shows without a fresh page. */
  books: (ledgerId: string) => ["ledger", ledgerId, "books"] as const,
  /**
   * The same list plus the archived rows. 设置 and the detail page need them,
   * the switcher must not see them, so they are a separate cache entry.
   */
  booksIncludingArchived: (ledgerId: string) =>
    ["ledger", ledgerId, "books", "including-archived"] as const,
  /** One book by id; the detail page uses it to name a retired book. */
  book: (ledgerId: string, bookId: string) => ["ledger", ledgerId, "book", bookId] as const,

  // === Source Documents ===
  sourceDocumentStream: (
    ledgerId: string,
    filters?: {
      bookId?: string | null | undefined;
      startDate?: string | null | undefined;
      endDate?: string | null | undefined;
      minAmount?: string | null | undefined;
      maxAmount?: string | null | undefined;
      statuses?: string | null | undefined;
      search?: string | null | undefined;
    }
  ) => ["ledger", ledgerId, "source-documents", "stream", normalizeQueryParams(filters)] as const,
  sourceDocumentStreamPrefix: (ledgerId: string) =>
    ["ledger", ledgerId, "source-documents", "stream"] as const,
  sourceDocumentStreamTotal: (
    ledgerId: string,
    filters?: {
      bookId?: string | null | undefined;
      startDate?: string | null | undefined;
      endDate?: string | null | undefined;
      minAmount?: string | null | undefined;
      maxAmount?: string | null | undefined;
      statuses?: string | null | undefined;
      search?: string | null | undefined;
    }
  ) =>
    [
      "ledger",
      ledgerId,
      "source-documents",
      "stream-total",
      normalizeQueryParams(filters),
    ] as const,
  sourceDocumentStreamTotalPrefix: (ledgerId: string) =>
    ["ledger", ledgerId, "source-documents", "stream-total"] as const,
  sourceDocument: (ledgerId: string, documentId: string) =>
    ["ledger", ledgerId, "source-document", documentId, "detail"] as const,
  sourceDocumentDetailPrefix: (ledgerId: string) =>
    ["ledger", ledgerId, "source-document"] as const,
  sourceDocumentInput: (ledgerId: string, id: string) =>
    ["ledger", ledgerId, "source-document", id, "input"] as const,
  sourceDocumentRefresh: (ledgerId: string) =>
    ["ledger", ledgerId, "source-documents", "refresh"] as const,

  // === Categories ===
  entryCategories: (ledgerId: string) => ["ledger", ledgerId, "categories"] as const,
  categoryReclassification: (ledgerId: string) =>
    ["ledger", ledgerId, "category-reclassification"] as const,
  categoryAssignmentResults: (ledgerId: string, jobId: string) =>
    ["ledger", ledgerId, "category-assignment", jobId, "results"] as const,
  ledgerSettings: (ledgerId: string) => ["ledger", ledgerId, "settings"] as const,

  // === Summary & Stats ===
  summary: (ledgerId: string, params?: QueryKeyParams | null) =>
    ["ledger", ledgerId, "summary", normalizeQueryParams(params)] as const,
  summaryPrefix: (ledgerId: string) => ["ledger", ledgerId, "summary"] as const,
  enhancedStats: (
    ledgerId: string,
    params?: {
      bookId?: string | null | undefined;
      startDate?: string | null | undefined;
      endDate?: string | null | undefined;
      compareStartDate?: string | null | undefined;
      compareEndDate?: string | null | undefined;
      rangeType?: string | null | undefined;
      comparisonMode?: string | null | undefined;
      mainCurrency?: string | null | undefined;
    }
  ) => ["ledger", ledgerId, "enhanced-stats", normalizeQueryParams(params)] as const,
  enhancedStatsPrefix: (ledgerId: string) => ["ledger", ledgerId, "enhanced-stats"] as const,

  // === Currency ===
  convert: (ledgerId: string, amount: string, from: string, to: string, date: string) =>
    ["ledger", ledgerId, "convert", amount, from, to, date] as const,
} as const;

type QueryKeyParams = Readonly<Record<string, unknown>>;

function normalizeQueryParams(params?: QueryKeyParams | null): Readonly<Record<string, unknown>> {
  if (params == null) return {};
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [key, value === undefined ? null : value])
  );
}
