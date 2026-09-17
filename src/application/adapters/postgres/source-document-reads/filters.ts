import { and, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { escapedLikeContains } from "@/lib/db/like-pattern";
import type { SourceDocumentProcessingStatus } from "@/modules/source-document/contracts";
import { normalize as decimalNormalize } from "@/lib/money/decimal";
import { ledgerEntries, sourceDocumentRevisions, sourceDocuments } from "@/persistence";

export interface TargetSourceDocumentFilterInput {
  ledgerId: string;
  attributedUserId?: string;
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
  const conditions: SQL<unknown>[] = [
    eq(sourceDocuments.ledgerId, input.ledgerId),
    isNull(sourceDocuments.deletedAt),
  ];
  if (input.attributedUserId != null)
    conditions.push(eq(sourceDocuments.attributedUserId, input.attributedUserId));
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
    conditions.push(sql`EXISTS (
      SELECT 1
      FROM ledger_entries AS matched_entries
      WHERE matched_entries.ledger_id = ${input.ledgerId}
        AND matched_entries.source_document_id = ${sourceDocuments.id}
        AND matched_entries.source_document_revision_id = ${sourceDocuments.activeRevisionId}
        AND matched_entries.deleted_at IS NULL
        ${input.minAmount !== undefined ? sql`AND matched_entries.converted_amount IS NOT NULL AND matched_entries.converted_amount >= ${input.minAmount}` : sql``}
        ${input.maxAmount !== undefined ? sql`AND matched_entries.converted_amount IS NOT NULL AND matched_entries.converted_amount <= ${input.maxAmount}` : sql``}
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
  const matchedEntryConditions: SQL<unknown>[] = [];
  if (input.minAmount !== undefined) {
    matchedEntryConditions.push(
      sql`${ledgerEntries.convertedAmount} IS NOT NULL
        AND ${ledgerEntries.convertedAmount} >= ${input.minAmount}`
    );
  }
  if (input.maxAmount !== undefined) {
    matchedEntryConditions.push(
      sql`${ledgerEntries.convertedAmount} IS NOT NULL
        AND ${ledgerEntries.convertedAmount} <= ${input.maxAmount}`
    );
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
      total: sql<string>`SUM(${ledgerEntries.convertedAmount})`,
      unconvertedCount: sql<number>`COUNT(*) FILTER (
        WHERE ${ledgerEntries.convertedAmount} IS NULL
      )`,
    })
    .from(sourceDocuments)
    .innerJoin(
      ledgerEntries,
      and(
        eq(ledgerEntries.ledgerId, sourceDocuments.ledgerId),
        eq(ledgerEntries.sourceDocumentId, sourceDocuments.id),
        eq(ledgerEntries.sourceDocumentRevisionId, sourceDocuments.activeRevisionId),
        isNull(ledgerEntries.deletedAt),
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
