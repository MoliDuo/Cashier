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

async function syncState() {
  const state = await getTestDb().query.ledgerSyncState.findFirst();
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
    await createTestUserWithLedger(db);
    const sourceDocumentId = await createTestSourceDocument(db);
    const before = await syncState();

    await db.transaction(async (tx) => {
      await tx.insert(ledgerEntries).values(
        ["Coffee", "Bagel", "Juice"].map((itemName, position) => ({
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
        .where(eq(ledgerEntries.sourceDocumentId, sourceDocumentId));
    });

    const after = await syncState();
    expect(after.version).toBe(before.version + BigInt(1));
    expect(after.stats).toBe(after.version);
    expect(after.categories).toBe(before.categories);
    expect(after.settings).toBe(before.settings);
  });

  it("moves each watermark only for the changes it covers", async () => {
    const db = getTestDb();
    await createTestUserWithLedger(db);
    const sourceDocumentId = await createTestSourceDocument(db, { status: "processing" });

    const initial = await syncState();
    await db
      .update(extractionAttempts)
      .set({ status: "cancelled" })
      .where(eq(extractionAttempts.sourceDocumentId, sourceDocumentId));
    const afterAttempt = await syncState();
    expect(afterAttempt.version).toBe(initial.version + BigInt(1));
    expect(afterAttempt.stats).toBe(initial.stats);

    await db.insert(entryCategories).values({ name: "Snacks" });
    const afterCategory = await syncState();
    expect(afterCategory.categories).toBe(afterCategory.version);
    expect(afterCategory.stats).toBe(afterCategory.version);
    expect(afterCategory.settings).toBe(initial.settings);

    await db.update(ledgers).set({ aiCustomPrompt: "Be brief" });
    const afterSetting = await syncState();
    expect(afterSetting.settings).toBe(afterSetting.version);
    expect(afterSetting.categories).toBe(afterCategory.categories);

    await db.update(ledgers).set({ mainCurrency: "USD" });
    const afterCurrency = await syncState();
    expect(afterCurrency).toEqual({
      version: afterCurrency.version,
      categories: afterCurrency.version,
      settings: afterCurrency.version,
      stats: afterCurrency.version,
    });
  });

  it("moves the version for a book, an API key and the ledger's zone, not a key's use", async () => {
    const db = getTestDb();
    await createTestUserWithLedger(db);
    const [book] = await db
      .insert(books)
      .values({ name: "旅行", sortOrder: 9 })
      .returning({ id: books.id });
    const afterBook = await syncState();

    const [credential] = await db
      .insert(serviceCredentials)
      .values({
        bookId: book!.id,
        name: "Shortcut",
        tokenHash: "a".repeat(64),
        tokenPrefix: "csh_abcd",
        tokenSuffix: "wxyz",
      })
      .returning({ id: serviceCredentials.id });
    const afterKey = await syncState();
    expect(afterKey.version).toBe(afterBook.version + BigInt(1));

    await db
      .update(serviceCredentials)
      .set({ lastUsedAt: new Date() })
      .where(eq(serviceCredentials.id, credential!.id));
    expect((await syncState()).version).toBe(afterKey.version);

    await db.update(ledgers).set({ timeZone: "Europe/Paris" });
    const afterZone = await syncState();
    expect(afterZone.version).toBe(afterKey.version + BigInt(1));
    expect(afterZone.stats).toBe(afterZone.version);
  });

  it("creates a ledger's sync row on its first change and lets the ledger go", async () => {
    const db = getTestDb();
    await createTestUserWithLedger(db);
    await db.delete(ledgerSyncState);

    await createTestSourceDocument(db);
    expect((await syncState()).version).toBeGreaterThan(BigInt(0));

    await expect(db.delete(ledgers)).resolves.toBeDefined();
    await expect(db.query.ledgerSyncState.findFirst()).resolves.toBeUndefined();
  });
});
