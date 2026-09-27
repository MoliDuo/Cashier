import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "tests/setup";
import { createTestSourceDocument, createTestUserWithLedger } from "tests/helpers/schema-setup";
import {
  books,
  entryCategories,
  extractionAttempts,
  ledgerEntries,
  ledgerSyncState,
  ledgers,
  serviceCredentials,
} from "@/persistence";

async function syncState(ledgerId: string) {
  const state = await getTestDb().query.ledgerSyncState.findFirst({
    where: eq(ledgerSyncState.ledgerId, ledgerId),
  });
  if (state == null) throw new Error("Expected a sync row for the ledger");
  return {
    version: state.version,
    categories: state.categoriesVersion,
    settings: state.settingsVersion,
    stats: state.statsVersion,
  };
}

describe("record_ledger_change trigger", () => {
  it("advances the ledger version once per transaction, however many rows change", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const sourceDocumentId = await createTestSourceDocument(db, ledgerId);
    const before = await syncState(ledgerId);

    await db.transaction(async (tx) => {
      await tx.insert(ledgerEntries).values(
        ["Coffee", "Bagel", "Juice"].map((itemName, position) => ({
          ledgerId,
          sourceDocumentId,
          position,
          itemName,
          amount: "1.00",
          currency: "CNY",
        }))
      );
      await tx
        .update(ledgerEntries)
        .set({ amount: "2.00" })
        .where(eq(ledgerEntries.ledgerId, ledgerId));
    });

    const after = await syncState(ledgerId);
    expect(after.version).toBe(before.version + BigInt(1));
    expect(after.stats).toBe(after.version);
    expect(after.categories).toBe(before.categories);
    expect(after.settings).toBe(before.settings);
  });

  it("moves each watermark only for the changes it covers", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const sourceDocumentId = await createTestSourceDocument(db, ledgerId, { status: "processing" });

    const initial = await syncState(ledgerId);
    await db
      .update(extractionAttempts)
      .set({ status: "cancelled" })
      .where(eq(extractionAttempts.sourceDocumentId, sourceDocumentId));
    const afterAttempt = await syncState(ledgerId);
    expect(afterAttempt.version).toBe(initial.version + BigInt(1));
    expect(afterAttempt.stats).toBe(initial.stats);

    await db.insert(entryCategories).values({ ledgerId, name: "Snacks" });
    const afterCategory = await syncState(ledgerId);
    expect(afterCategory.categories).toBe(afterCategory.version);
    expect(afterCategory.stats).toBe(afterCategory.version);
    expect(afterCategory.settings).toBe(initial.settings);

    await db.update(ledgers).set({ aiCustomPrompt: "Be brief" }).where(eq(ledgers.id, ledgerId));
    const afterSetting = await syncState(ledgerId);
    expect(afterSetting.settings).toBe(afterSetting.version);
    expect(afterSetting.categories).toBe(afterCategory.categories);

    await db.update(ledgers).set({ mainCurrency: "USD" }).where(eq(ledgers.id, ledgerId));
    const afterCurrency = await syncState(ledgerId);
    expect(afterCurrency).toEqual({
      version: afterCurrency.version,
      categories: afterCurrency.version,
      settings: afterCurrency.version,
      stats: afterCurrency.version,
    });
  });

  it("moves the version for a book, an API key and the ledger's zone, not a key's use", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const [book] = await db
      .insert(books)
      .values({ ledgerId, name: "旅行", sortOrder: 9 })
      .returning({ id: books.id });
    const afterBook = await syncState(ledgerId);

    const [credential] = await db
      .insert(serviceCredentials)
      .values({
        ledgerId,
        bookId: book!.id,
        name: "Shortcut",
        tokenHash: "a".repeat(64),
        tokenPrefix: "csh_abcd",
        tokenSuffix: "wxyz",
      })
      .returning({ id: serviceCredentials.id });
    const afterKey = await syncState(ledgerId);
    expect(afterKey.version).toBe(afterBook.version + BigInt(1));

    await db
      .update(serviceCredentials)
      .set({ lastUsedAt: new Date() })
      .where(eq(serviceCredentials.id, credential!.id));
    expect((await syncState(ledgerId)).version).toBe(afterKey.version);

    await db.update(ledgers).set({ timeZone: "Europe/Paris" }).where(eq(ledgers.id, ledgerId));
    const afterZone = await syncState(ledgerId);
    expect(afterZone.version).toBe(afterKey.version + BigInt(1));
    expect(afterZone.stats).toBe(afterZone.version);
  });

  it("creates a ledger's sync row on its first change and lets the ledger go", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    await db.delete(ledgerSyncState).where(eq(ledgerSyncState.ledgerId, ledgerId));

    await createTestSourceDocument(db, ledgerId);
    expect((await syncState(ledgerId)).version).toBeGreaterThan(BigInt(0));

    await expect(db.delete(ledgers).where(eq(ledgers.id, ledgerId))).resolves.toBeDefined();
    await expect(
      db.query.ledgerSyncState.findFirst({ where: eq(ledgerSyncState.ledgerId, ledgerId) })
    ).resolves.toBeUndefined();
  });
});
