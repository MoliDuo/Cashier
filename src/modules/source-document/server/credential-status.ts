import { and, eq, sql } from "drizzle-orm";
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
  // Load the document, its latest attempt, its entries and the ledger's main
  // currency in a single query so status polling does not fan out into
  // sequential reads. The attempt must belong to both the document and the
  // same ledger; a record entered by hand has none.
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
          WHERE entry.source_document_id = ${sourceDocuments.id}
            AND entry.ledger_id = ${ledgerId}
        ), '[]'::jsonb)`,
    })
    .from(sourceDocuments)
    .leftJoin(
      sourceDocumentRevisions,
      and(
        eq(sourceDocumentRevisions.id, sourceDocuments.latestSubmissionRevisionId),
        eq(sourceDocumentRevisions.sourceDocumentId, sourceDocuments.id),
        eq(sourceDocumentRevisions.ledgerId, ledgerId)
      )
    )
    .innerJoin(ledgers, eq(ledgers.id, sourceDocuments.ledgerId))
    .where(and(eq(sourceDocuments.id, sourceDocumentId), eq(sourceDocuments.ledgerId, ledgerId)))
    .limit(1);
  const row = rows[0];
  if (row == null) return null;
  const { document, revision } = row;
  const status =
    revision == null
      ? "completed"
      : revision.failureKind === "invalid_input"
        ? "invalid"
        : (revision.processingStatus as CredentialSourceDocumentStatusResult["status"]);
  let result: CredentialSourceDocumentStatusResult["result"] = null;
  if (status === "completed") {
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
      ? { code: toStableFailureCode(revision?.failureCode ?? null) }
      : status === "invalid"
        ? { code: "VALIDATION_FAILED", message: revision?.failureMessage ?? null }
        : null;
  return {
    sourceDocumentId: document.id,
    revisionId: revision?.id ?? null,
    status,
    submittedAt: (revision?.submittedAt ?? document.createdAt).toISOString(),
    finalizedAt:
      revision == null
        ? document.createdAt.toISOString()
        : (revision.finishedAt?.toISOString() ?? null),
    entryDate: document.documentDate,
    result,
    error,
  };
}
