import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getCurrentSession } from "@/modules/auth/server/current-session";
import { testSession } from "tests/helpers/session";
import { saveSourceDocumentChangesAction } from "@/modules/source-document/server-actions/update";
import { entryCategories, ledgerEntries, ledgers, sourceDocuments } from "@/persistence";
import * as exchangeRates from "@/modules/currency/server/exchange-rates";
import { getTestDb } from "tests/setup";
import {
  activateTestSourceDocumentProjection,
  ensureTestLedgerBooks,
} from "tests/helpers/schema-setup";
import {
  createCategoryData,
  createLedgerData,
  createSourceDocumentData,
} from "tests/helpers/factories";

vi.mock("@/modules/auth/server/current-session", () => ({ getCurrentSession: vi.fn() }));

describe("saveSourceDocumentChangesAction", () => {
  const userId = "00000000-0000-0000-0000-000000000000";
  beforeEach(() => vi.mocked(getCurrentSession).mockResolvedValue(testSession(userId)));

  async function seed() {
    const db = getTestDb();
    const ledger = createLedgerData({ mainCurrency: "USD" });
    const document = createSourceDocumentData(ledger.id, {
      status: "completed",
      title: "Original",
    });
    const entryId = crypto.randomUUID();
    await db.insert(ledgers).values(ledger);
    await ensureTestLedgerBooks(db, ledger.id);
    await db.insert(sourceDocuments).values({
      ...document,
      bookId: sql`(SELECT id FROM books WHERE ledger_id = ${document.ledgerId} ORDER BY sort_order LIMIT 1)`,
    });
    await db.insert(ledgerEntries).values({
      id: entryId,
      ledgerId: ledger.id,
      sourceDocumentId: document.id,
      amount: "10.000",
      currency: "USD",
      itemName: "First",
    });
    await activateTestSourceDocumentProjection(db, document.id);
    return { db, ledger, document, entryId };
  }

  it("commits metadata and entry changes once while preserving the entry ID", async () => {
    const fixture = await seed();
    const result = await saveSourceDocumentChangesAction({
      sourceDocumentId: fixture.document.id,
      expectedVersion: 1,
      sourceDocument: { title: "Updated" },
      entries: [{ ledgerEntryId: fixture.entryId, data: { itemName: "Updated entry" } }],
    });
    expect(result).toEqual({
      ok: true,
      sourceDocumentId: fixture.document.id,
      version: 2,
      data: { updatedEntryIds: [fixture.entryId] },
    });
    const entry = await fixture.db.query.ledgerEntries.findFirst({
      where: eq(ledgerEntries.id, fixture.entryId),
    });
    expect(entry?.itemName).toBe("Updated entry");
  });

  it("keeps a category another writer set while the save was in flight", async () => {
    const fixture = await seed();
    const category = createCategoryData(fixture.ledger.id, { name: "Meals", sortOrder: 0 });
    await fixture.db.insert(entryCategories).values(category);
    // A category assignment commits between the save's reads and its write,
    // without advancing the document version.
    const ensure = vi.spyOn(exchangeRates, "ensureExchangeRates").mockImplementation(async () => {
      await fixture.db
        .update(ledgerEntries)
        .set({ categoryId: category.id })
        .where(eq(ledgerEntries.id, fixture.entryId));
    });

    const result = await saveSourceDocumentChangesAction({
      sourceDocumentId: fixture.document.id,
      expectedVersion: 1,
      entries: [{ ledgerEntryId: fixture.entryId, data: { currency: "EUR" } }],
    });

    expect(ensure).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ ok: true, version: 2 });
    expect(
      await fixture.db.query.ledgerEntries.findFirst({
        where: eq(ledgerEntries.id, fixture.entryId),
      })
    ).toMatchObject({ currency: "EUR", categoryId: category.id });
    ensure.mockRestore();
  });

  it("returns stale on replay and performs no additional write", async () => {
    const fixture = await seed();
    const input = {
      sourceDocumentId: fixture.document.id,
      expectedVersion: 1,
      sourceDocument: { title: "Updated" },
      entries: [],
    };
    await expect(saveSourceDocumentChangesAction(input)).resolves.toMatchObject({
      ok: true,
      version: 2,
    });
    await expect(saveSourceDocumentChangesAction(input)).resolves.toMatchObject({
      ok: false,
      reason: "stale",
      currentVersion: 2,
    });
  });

  it("returns the original version for a no-op", async () => {
    const fixture = await seed();
    await expect(
      saveSourceDocumentChangesAction({
        sourceDocumentId: fixture.document.id,
        expectedVersion: 1,
        sourceDocument: { title: "Original" },
        entries: [],
      })
    ).resolves.toMatchObject({ ok: true, version: 1 });
  });

  it.each(["10", "10.00", "10.000"])(
    "treats numerically equivalent amount %s as a no-op",
    async (amount) => {
      const fixture = await seed();
      await expect(
        saveSourceDocumentChangesAction({
          sourceDocumentId: fixture.document.id,
          expectedVersion: 1,
          entries: [{ ledgerEntryId: fixture.entryId, data: { amount } }],
        })
      ).resolves.toMatchObject({ ok: true, version: 1 });

      const document = await fixture.db.query.sourceDocuments.findFirst({
        where: eq(sourceDocuments.id, fixture.document.id),
      });
      expect(document?.version).toBe(1);
    }
  );
});
