import { and, eq, inArray, isNull } from "drizzle-orm";
import type { LedgerProjectionEntryContract } from "@/application/contracts";
export { LedgerMainCurrencyChangedError } from "@/application/contracts";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { isValidDecimal } from "@/lib/money/decimal";
import { entryCategories, ledgerEntries, sourceDocuments } from "@/persistence";
import type { PostgresTransaction } from "@/application/adapters/postgres/transaction-locks";

export function activeDocumentWhere(ledgerId: string, sourceDocumentId: string) {
  return and(
    eq(sourceDocuments.ledgerId, ledgerId),
    eq(sourceDocuments.id, sourceDocumentId),
    isNull(sourceDocuments.deletedAt)
  )!;
}

export function assertEntryValues(entries: readonly LedgerProjectionEntryContract[]): void {
  for (const entry of entries) {
    if (entry.itemName.trim() === "" || !isValidDecimal(entry.amount)) {
      throw new ValidationError(
        "Ledger projection entries require an item name and numeric amount"
      );
    }
  }
}

export function requireCurrency(currency: string | null): string {
  if (currency == null) throw new ValidationError("Ledger projection entries require a currency");
  return currency;
}

export async function assertCategoryOwnership(
  tx: PostgresTransaction,
  ledgerId: string,
  entries: readonly LedgerProjectionEntryContract[]
): Promise<void> {
  const categoryIds = [
    ...new Set(entries.flatMap((entry) => (entry.categoryId == null ? [] : [entry.categoryId]))),
  ];
  if (categoryIds.length === 0) return;
  const owned = await tx
    .select({ id: entryCategories.id })
    .from(entryCategories)
    .where(
      and(
        eq(entryCategories.ledgerId, ledgerId),
        inArray(entryCategories.id, categoryIds),
        isNull(entryCategories.deletedAt)
      )
    );
  if (owned.length !== categoryIds.length) {
    throw new NotFoundError("Entry category");
  }
}

export async function insertRevisionEntries(
  tx: PostgresTransaction,
  input: {
    ledgerId: string;
    sourceDocumentId: string;
    revisionId: string;
    entries: readonly LedgerProjectionEntryContract[];
  }
): Promise<void> {
  if (input.entries.length === 0) return;
  await tx.insert(ledgerEntries).values(
    input.entries.map((entry, position) => ({
      id: entry.id ?? crypto.randomUUID(),
      ledgerId: input.ledgerId,
      sourceDocumentId: input.sourceDocumentId,
      sourceDocumentRevisionId: input.revisionId,
      position,
      categoryId: entry.categoryId,
      amount: entry.amount,
      currency: requireCurrency(entry.currency),
      itemName: entry.itemName,
      description: entry.description,
      convertedAmount: entry.convertedAmount,
      exchangeRate: entry.exchangeRate,
      ...(entry.createdAt == null ? {} : { createdAt: new Date(entry.createdAt) }),
    }))
  );
}

export async function replaceProjection(
  tx: PostgresTransaction,
  input: {
    ledgerId: string;
    sourceDocumentId: string;
    revisionId: string;
    entries: readonly LedgerProjectionEntryContract[];
  }
): Promise<void> {
  assertEntryValues(input.entries);
  await assertCategoryOwnership(tx, input.ledgerId, input.entries);
  const now = new Date();
  await tx
    .update(ledgerEntries)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      and(
        eq(ledgerEntries.ledgerId, input.ledgerId),
        eq(ledgerEntries.sourceDocumentId, input.sourceDocumentId),
        isNull(ledgerEntries.deletedAt)
      )
    );
  await insertRevisionEntries(tx, input);
}
