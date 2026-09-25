import { and, eq, isNull, sql } from "drizzle-orm";
import "server-only";
import { db } from "@/lib/db";
import { ledgers, sourceDocumentRevisions, sourceDocuments } from "@/persistence";
import { toStableFailureCode } from "@/modules/source-document/lifecycle";
import { accountingTotal } from "@/lib/money/accounting-total";
import type { CredentialSourceDocumentStatusResult } from "@/modules/source-document/contracts";

export async function getCredentialSourceDocumentStatus(
  ledgerId: string,
  sourceDocumentId: string
): Promise<CredentialSourceDocumentStatusResult | null> {
  // Load the document, its selected revision (pending ?? active), and the
  // ledger's main currency in a single query so status polling does not fan
  // out into three sequential reads. The revision must belong to both the
  // document and the same ledger.
  const selectedRevisionId = sql<string>`COALESCE(${sourceDocuments.latestSubmissionRevisionId}, ${sourceDocuments.activeRevisionId})`;
  const rows = await db
    .select({
      document: sourceDocuments,
      revision: sourceDocumentRevisions,
      mainCurrency: ledgers.mainCurrency,
      entries: sql<
        Array<{
          name: string;
          description: string | null;
          amount: string;
          currency: string | null;
          convertedAmount: string | null;
          category: string | null;
        }>
      >`COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'name', entry.item_name,
            'description', entry.description,
            'amount', entry.amount::text,
            'currency', entry.currency,
            'convertedAmount', convert_amount(entry.amount, entry.currency,
              ${ledgers.mainCurrency}, ${sourceDocuments.effectiveDate})::text,
            'category', category.name
          ) ORDER BY entry.position, entry.created_at, entry.id)
          FROM ledger_entries entry
          LEFT JOIN entry_categories category ON category.id = entry.category_id
          WHERE entry.source_document_revision_id = ${selectedRevisionId}
            AND entry.ledger_id = ${ledgerId}
            AND entry.deleted_at IS NULL
        ), '[]'::jsonb)`,
    })
    .from(sourceDocuments)
    .innerJoin(
      sourceDocumentRevisions,
      and(
        eq(sourceDocumentRevisions.id, selectedRevisionId),
        eq(sourceDocumentRevisions.sourceDocumentId, sourceDocuments.id),
        eq(sourceDocumentRevisions.ledgerId, ledgerId)
      )
    )
    .innerJoin(ledgers, eq(ledgers.id, sourceDocuments.ledgerId))
    .where(
      and(
        eq(sourceDocuments.id, sourceDocumentId),
        eq(sourceDocuments.ledgerId, ledgerId),
        isNull(sourceDocuments.deletedAt)
      )
    )
    .limit(1);
  const row = rows[0];
  if (row == null) return null;
  const { document, revision } = row;
  const status =
    revision.failureKind === "invalid_input"
      ? "invalid"
      : (revision.processingStatus as CredentialSourceDocumentStatusResult["status"]);
  let result: CredentialSourceDocumentStatusResult["result"] = null;
  if (status === "completed" && document.activeRevisionId != null) {
    result = {
      title: document.title,
      total: accountingTotal(row.entries, row.mainCurrency),
      totalCurrency: row.mainCurrency,
      entries: row.entries.map(({ name, description, amount, currency, category }) => ({
        name,
        description,
        amount,
        currency,
        category,
      })),
    };
  }
  // An unparsable document reports the stable VALIDATION_FAILED code — this
  // replaces the four legacy invalid codes — plus the natural-language reason
  // the ledger owner reads, which may be absent.
  const error =
    status === "failed"
      ? { code: toStableFailureCode(revision.failureCode) }
      : status === "invalid"
        ? { code: "VALIDATION_FAILED", message: revision.failureMessage }
        : null;
  return {
    sourceDocumentId: document.id,
    revisionId: revision.id,
    status,
    submittedAt: revision.submittedAt.toISOString(),
    finalizedAt: revision.finishedAt?.toISOString() ?? null,
    entryDate: document.documentDate,
    result,
    error,
  };
}
