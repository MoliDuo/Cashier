import { sql, type SQL } from "drizzle-orm";
import { ledgerEntries } from "@/persistence";

// An entry is visible while it and its document are live.

interface SourceDocumentDateRange {
  startDate?: string | null;
  endDate?: string | null;
}

export function buildLedgerEntryVisibilityCondition(
  ledgerId: string,
  dateRange?: SourceDocumentDateRange
): SQL<unknown> {
  return sql`EXISTS (
    SELECT 1
    FROM source_documents AS active_documents
    WHERE active_documents.ledger_id = ${ledgerId}
      AND active_documents.id = ${ledgerEntries.sourceDocumentId}
      AND active_documents.deleted_at IS NULL
      ${
        dateRange?.startDate != null && dateRange.startDate !== ""
          ? sql`AND active_documents.effective_date >= ${dateRange.startDate}::date`
          : sql``
      }
      ${
        dateRange?.endDate != null && dateRange.endDate !== ""
          ? sql`AND active_documents.effective_date <= ${dateRange.endDate}::date`
          : sql``
      }
  )`;
}

export function buildLedgerEntrySourceDocumentDateCondition(
  ledgerId: string,
  dateRange: SourceDocumentDateRange
): SQL<unknown> | null {
  const hasStartDate = dateRange.startDate != null && dateRange.startDate !== "";
  const hasEndDate = dateRange.endDate != null && dateRange.endDate !== "";
  if (!hasStartDate && !hasEndDate) {
    return null;
  }

  return buildLedgerEntryVisibilityCondition(ledgerId, dateRange);
}
