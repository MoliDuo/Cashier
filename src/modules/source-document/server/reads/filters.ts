import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { escapedLikeContains } from "@/lib/db/like-pattern";
import type { SourceDocumentProcessingStatus } from "@/modules/source-document/contracts";
import { normalize as decimalNormalize } from "@/lib/money/decimal";
import { ledgerEntries, sourceDocumentRevisions, sourceDocuments } from "@/persistence";
import { convertedAmountSql } from "@/modules/currency/server/conversion-sql";

// Amount filters and totals convert in the document's ledger currency on the
// document's day; an entry without a rate matches no amount bound.
const documentMainCurrency = sql`(SELECT document_ledger.main_currency FROM ledgers document_ledger
  WHERE document_ledger.id = ${sourceDocuments.ledgerId})`;

export interface TargetSourceDocumentFilterInput {
  ledgerId: string;
  bookId?: string;
  statuses?: readonly SourceDocumentProcessingStatus[];
  startDate?: string | null;
  endDate?: string | null;
  minAmount?: string;
  maxAmount?: string;
  search?: string;
}

export interface TargetSourceDocumentListInput extends TargetSourceDocumentFilterInput {
  cursor?: string | null;
  limit: number;
}

export function baseConditions(input: TargetSourceDocumentFilterInput): SQL<unknown>[] {
  const conditions: SQL<unknown>[] = [eq(sourceDocuments.ledgerId, input.ledgerId)];
  if (input.bookId != null) conditions.push(eq(sourceDocuments.bookId, input.bookId));
  if (input.statuses != null && input.statuses.length > 0) {
    conditions.push(
      sql`EXISTS (
        SELECT 1 FROM ${sourceDocumentRevisions}
        WHERE ${sourceDocumentRevisions.id} = ${sourceDocuments.latestSubmissionRevisionId}
          AND ${sourceDocumentRevisions.ledgerId} = ${input.ledgerId}
          AND ${inArray(sourceDocumentRevisions.processingStatus, input.statuses)}
      )`
    );
  }
  if (input.startDate != null && input.startDate !== "") {
    conditions.push(sql`${sourceDocuments.effectiveDate} >= ${input.startDate}::date`);
  }
  if (input.endDate != null && input.endDate !== "") {
    conditions.push(sql`${sourceDocuments.effectiveDate} <= ${input.endDate}::date`);
  }
  const searchPattern =
    input.search != null && input.search !== "" ? escapedLikeContains(input.search) : null;
  if (
    input.minAmount !== undefined ||
    input.maxAmount !== undefined ||
    (input.search != null && input.search !== "")
  ) {
    const matchedConverted = convertedAmountSql({
      amount: sql`matched_entries.amount`,
      currency: sql`matched_entries.currency`,
      mainCurrency: documentMainCurrency,
      date: sourceDocuments.effectiveDate,
    });
    conditions.push(sql`EXISTS (
      SELECT 1
      FROM ledger_entries AS matched_entries
      WHERE matched_entries.ledger_id = ${input.ledgerId}
        AND matched_entries.source_document_id = ${sourceDocuments.id}
        ${input.minAmount !== undefined ? sql`AND ${matchedConverted} >= ${input.minAmount}` : sql``}
        ${input.maxAmount !== undefined ? sql`AND ${matchedConverted} <= ${input.maxAmount}` : sql``}
        ${
          searchPattern != null
            ? sql`AND lower(matched_entries.item_name || ' ' || COALESCE(matched_entries.description, ''))
          LIKE ${searchPattern}`
            : sql``
        }
    )`);
  }
  return conditions;
}

/** Sum active projections across the full filtered Stream result. */
export async function calculateCompletedSourceDocumentTotal(
  input: TargetSourceDocumentFilterInput
): Promise<{ total: string; unconvertedCount: number }> {
  const converted = convertedAmountSql({
    amount: ledgerEntries.amount,
    currency: ledgerEntries.currency,
    mainCurrency: documentMainCurrency,
    date: sourceDocuments.effectiveDate,
  });
  const matchedEntryConditions: SQL<unknown>[] = [];
  if (input.minAmount !== undefined) {
    matchedEntryConditions.push(sql`${converted} >= ${input.minAmount}`);
  }
  if (input.maxAmount !== undefined) {
    matchedEntryConditions.push(sql`${converted} <= ${input.maxAmount}`);
  }
  if (input.search != null && input.search !== "") {
    const searchPattern = escapedLikeContains(input.search);
    matchedEntryConditions.push(
      sql`lower(${ledgerEntries.itemName} || ' ' || COALESCE(${ledgerEntries.description}, ''))
        LIKE ${searchPattern}`
    );
  }
  const result = await db
    .select({
      total: sql<string>`SUM(${converted})`,
      unconvertedCount: sql<number>`COUNT(*) FILTER (WHERE ${converted} IS NULL)`,
    })
    .from(sourceDocuments)
    .innerJoin(
      ledgerEntries,
      and(
        eq(ledgerEntries.ledgerId, sourceDocuments.ledgerId),
        eq(ledgerEntries.sourceDocumentId, sourceDocuments.id),
        ...matchedEntryConditions
      )
    )
    .where(and(...baseConditions(input)))
    .then((rows) => rows[0]);

  return {
    total: decimalNormalize(String(result?.total ?? "0")),
    unconvertedCount: Number(result?.unconvertedCount ?? 0),
  };
}
