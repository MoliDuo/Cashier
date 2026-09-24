import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { saveSourceDocumentChangesAction } from "@/modules/source-document/server-actions/update";
import { ledgerEntries, ledgers, sourceDocuments } from "@/persistence";
import { getTestDb } from "../../../../../setup";
import {
  activateTestSourceDocumentProjection,
  ensureTestLedgerBooks,
} from "../../../../../helpers/schema-setup";
import { createLedgerData, createSourceDocumentData } from "../../../../../helpers/factories";

vi.mock("@/auth", () => ({ auth: vi.fn() }));

describe("saveSourceDocumentChangesAction", () => {
  const userId = "00000000-0000-0000-0000-000000000000";
  beforeEach(() =>
    vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue({
      user: { id: userId },
      expires: new Date(Date.now() + 1000).toISOString(),
    })
  );

  async function seed() {
    const db = getTestDb();
    const ledger = createLedgerData({ userId, mainCurrency: "USD" });
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
      convertedAmount: "10.000",
      exchangeRate: "1",
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
    expect(entry?.deletedAt).toBeNull();
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
