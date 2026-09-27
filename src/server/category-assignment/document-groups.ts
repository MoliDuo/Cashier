import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  entryCategories,
  ledgerEntries,
  sourceDocumentFiles,
  sourceDocuments,
} from "@/persistence";
import type {
  CategoryAssignmentDocumentGroup,
  CategoryAssignmentSubject,
} from "@/modules/ledger/domain/category-assignment-protocol";

/**
 * The selected entries grouped by the source document their evidence hangs
 * off. Three narrow reads — entries, their documents, the documents' files —
 * so a document's input text is read once rather than per entry and image.
 */
export async function loadCategoryAssignmentDocumentGroups(input: {
  ledgerId: string;
  ledgerEntryIds: readonly string[];
}): Promise<readonly CategoryAssignmentDocumentGroup[]> {
  if (input.ledgerEntryIds.length === 0) return [];
  const entries = await db
    .select({
      ledgerEntryId: ledgerEntries.id,
      position: ledgerEntries.position,
      itemName: ledgerEntries.itemName,
      description: ledgerEntries.description,
      amount: ledgerEntries.amount,
      currency: ledgerEntries.currency,
      currentCategoryId: ledgerEntries.categoryId,
      currentCategoryName: entryCategories.name,
      sourceDocumentId: ledgerEntries.sourceDocumentId,
    })
    .from(ledgerEntries)
    .leftJoin(
      entryCategories,
      and(
        eq(entryCategories.id, ledgerEntries.categoryId),
        eq(entryCategories.ledgerId, input.ledgerId)
      )
    )
    .where(
      and(
        eq(ledgerEntries.ledgerId, input.ledgerId),
        inArray(ledgerEntries.id, input.ledgerEntryIds)
      )
    );
  if (entries.length === 0) return [];

  const documentIds = [...new Set(entries.map((entry) => entry.sourceDocumentId))];
  const [documents, files] = await Promise.all([
    db
      .select({
        id: sourceDocuments.id,
        title: sourceDocuments.title,
        documentDate: sourceDocuments.documentDate,
        inputText: sourceDocuments.inputText,
      })
      .from(sourceDocuments)
      .where(
        and(eq(sourceDocuments.ledgerId, input.ledgerId), inArray(sourceDocuments.id, documentIds))
      ),
    // A text-only record has no files; its entries still take part.
    db
      .select({
        sourceDocumentId: sourceDocumentFiles.sourceDocumentId,
        storedFileId: sourceDocumentFiles.storedFileId,
      })
      .from(sourceDocumentFiles)
      .where(
        and(
          eq(sourceDocumentFiles.ledgerId, input.ledgerId),
          inArray(sourceDocumentFiles.sourceDocumentId, documentIds)
        )
      )
      .orderBy(sourceDocumentFiles.position, sourceDocumentFiles.storedFileId),
  ]);

  const byString = (left: string, right: string): number =>
    left < right ? -1 : left > right ? 1 : 0;

  return documents
    .sort((left, right) => byString(left.id, right.id))
    .map((document): CategoryAssignmentDocumentGroup => ({
      sourceDocumentId: document.id,
      title: document.title,
      documentDate: document.documentDate,
      inputText: document.inputText,
      storedFileIds: files
        .filter((file) => file.sourceDocumentId === document.id)
        .map((file) => file.storedFileId),
      // Document order, not caller order: the model reads the entries in the
      // same sequence as the receipt it is looking at.
      subjects: entries
        .filter((entry) => entry.sourceDocumentId === document.id)
        .sort(
          (left, right) =>
            left.position - right.position || byString(left.ledgerEntryId, right.ledgerEntryId)
        )
        .map((entry): CategoryAssignmentSubject => ({
          ledgerEntryId: entry.ledgerEntryId,
          itemName: entry.itemName,
          description: entry.description,
          amount: entry.amount,
          currency: entry.currency,
          currentCategoryId: entry.currentCategoryId,
          currentCategoryName: entry.currentCategoryName,
        })),
    }));
}
