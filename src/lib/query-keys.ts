/**
 * Centralized Query Key Factory
 *
 * All React Query keys should be defined here to ensure consistency
 * between data fetching (useQuery) and SSE cache invalidation (invalidation-hub).
 *
 * Usage:
 *   import { queryKeys } from '@/lib/query-keys';
 *   useQuery({ queryKey: queryKeys.ledgerEntries(ledgerId, { status: 'pending' }), ... })
 */

export const queryKeys = {
  // === Ledger ===
  ledger: (ledgerId: string) => ["ledger", ledgerId] as const,
  ledgers: () => ["ledgers"] as const,

  // === Ledger Entries ===
  ledgerEntries: (ledgerId: string, params?: QueryKeyParams | null) =>
    ["ledger", ledgerId, "entries", normalizeQueryParams(params)] as const,
  ledgerEntriesPrefix: (ledgerId: string) => ["ledger", ledgerId, "entries"] as const,
  ledgerEntry: (ledgerId: string, entryId: string) =>
    ["ledger", ledgerId, "entry", entryId] as const,
  ledgerEntryPrefix: (ledgerId: string) => ["ledger", ledgerId, "entry"] as const,

  // === Members ===
  /** Both profiles, so a rename shows up in the switch without a fresh page. */
  coupleMembers: (ledgerId: string) => ["ledger", ledgerId, "members"] as const,

  // === Source Documents ===
  sourceDocuments: (ledgerId: string, params?: QueryKeyParams | null) =>
    ["ledger", ledgerId, "source-documents", normalizeQueryParams(params)] as const,
  sourceDocumentStream: (
    ledgerId: string,
    filters?: {
      attributedUserId?: string | null | undefined;
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
      attributedUserId?: string | null | undefined;
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
  sourceDocumentLight: (ledgerId: string, documentId: string) =>
    ["ledger", ledgerId, "source-document", documentId, "light"] as const,
  sourceDocumentFull: (ledgerId: string, id: string) =>
    ["ledger", ledgerId, "source-document", id, "full"] as const,
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
  tokenStats: (ledgerId: string) => ["ledger", ledgerId, "token-stats"] as const,
  enhancedStats: (
    ledgerId: string,
    params?: {
      attributedUserId?: string | null | undefined;
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
  batchConvert: (cacheKey: string, targetCurrency: string) =>
    ["batchConvert", cacheKey, targetCurrency] as const,

  // === Calendar ===
  calendarHeatmap: (
    ledgerId: string,
    viewType: string,
    anchorDate: string,
    filters?: { currency?: string; categoryId?: string }
  ) => ["ledger", ledgerId, "calendar", "heatmap", viewType, anchorDate, filters] as const,

  calendarHeatmapForRange: (
    ledgerId: string,
    startDate: string,
    endDate: string,
    filters?: { currency?: string; categoryId?: string }
  ) => ["ledger", ledgerId, "calendar", "heatmap-range", startDate, endDate, filters] as const,

  calendarDayDetail: (
    ledgerId: string,
    date: string,
    filters?: { currency?: string; categoryId?: string }
  ) => ["ledger", ledgerId, "calendar", "day", date, filters] as const,
  calendarPrefix: (ledgerId: string) => ["ledger", ledgerId, "calendar"] as const,
} as const;

type QueryKeyParams = Readonly<Record<string, unknown>>;

function normalizeQueryParams(params?: QueryKeyParams | null): Readonly<Record<string, unknown>> {
  if (params == null) return {};
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [key, value === undefined ? null : value])
  );
}
