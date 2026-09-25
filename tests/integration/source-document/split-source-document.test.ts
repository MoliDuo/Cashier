import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { splitSourceDocumentAction } from "@/modules/source-document/server-actions/split";
import {
  ledgerEntries,
  ledgers,
  sourceDocumentFiles,
  sourceDocuments,
  storedFiles,
} from "@/persistence";
import { getTestDb } from "../../setup";
import {
  activateTestSourceDocumentProjection,
  ensureTestLedgerBooks,
} from "../../helpers/schema-setup";
import { createLedgerData, createSourceDocumentData } from "../../helpers/factories";
import { insertExchangeRates } from "../../helpers/exchange-rates";
import { listStreamPage } from "@/modules/source-document/server/list-stream-page";
import { getTargetSourceDocument } from "@/modules/source-document/server/reads/list";
import { getSourceDocumentInput } from "@/modules/source-document/server/reads/input";

vi.mock("@/auth", () => ({ auth: vi.fn() }));

describe("splitSourceDocumentAction", () => {
  it("converts moved entries at the split document's day and returns the next split baseline", async () => {
    const fixture = await seed();
    await insertExchangeRates("2026-08-16", { USD: "1.25", MYR: "5" });
    await fixture.db
      .update(ledgerEntries)
      .set({ currency: "MYR", amount: "10.00" })
      .where(eq(ledgerEntries.ledgerId, fixture.ledger.id));
    for (const [index, id] of fixture.ids.slice(0, 2).entries()) {
      const result = await splitSourceDocumentAction({
        sourceDocumentId: fixture.document.id,
        ledgerEntryIds: [id],
        entryDate: "2026-08-16",
      });
      expect(result).toMatchObject({ sourceDocument: { version: index + 2 } });
      expect(result.sourceDocument.ledgerEntries).toHaveLength(2 - index);
    }
    const split = await listStreamPage(fixture.ledger.id, { limit: 20 });
    const movedEntries = split.items
      .filter((item) => item.documentDate === "2026-08-16")
      .flatMap((item) => item.ledgerEntries ?? []);
    // 10 MYR at 1.25 / 5 USD per MYR.
    expect(movedEntries.map((entry) => entry.convertedAmount)).toEqual(["2.50", "2.50"]);
  });

  const userId = "00000000-0000-0000-0000-000000000000";
  beforeEach(() => {
    vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue({
      user: { id: userId, email: "split@example.com" },
      expires: new Date(Date.now() + 3_600_000).toISOString(),
    });
  });

  async function seed(entryCount = 3) {
    const db = getTestDb();
    const ledger = createLedgerData({ mainCurrency: "USD" });
    const document = createSourceDocumentData(ledger.id, { status: "completed" });
    const ids = Array.from({ length: entryCount }, () => crypto.randomUUID());
    await db.insert(ledgers).values(ledger);
    await ensureTestLedgerBooks(db, ledger.id);
    await db.insert(sourceDocuments).values({
      ...document,
      bookId: sql`(SELECT id FROM books WHERE ledger_id = ${document.ledgerId} ORDER BY sort_order LIMIT 1)`,
    });
    await db.insert(ledgerEntries).values(
      ids.map((id, position) => ({
        id,
        ledgerId: ledger.id,
        sourceDocumentId: document.id,
        position,
        amount: `${position + 1}0.00`,
        currency: "USD",
        itemName: `Item ${position + 1}`,
      }))
    );
    await activateTestSourceDocumentProjection(db, document.id);
    return { db, ledger, document, ids };
  }

  it("moves live rows without changing entry IDs and versions both documents correctly", async () => {
    const fixture = await seed();
    const movedIds = [fixture.ids[0]!, fixture.ids[2]!];
    const result = await splitSourceDocumentAction({
      sourceDocumentId: fixture.document.id,
      ledgerEntryIds: movedIds,
      entryDate: "2026-08-16",
    });
    expect(result).toMatchObject({
      sourceDocument: { version: 2 },
      splitVersion: 1,
      movedEntryCount: 2,
    });
    const live = await fixture.db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.ledgerId, fixture.ledger.id));
    expect(
      live
        .filter((entry) => entry.sourceDocumentId === result.splitSourceDocumentId)
        .map((entry) => entry.id)
        .sort()
    ).toEqual([...movedIds].sort());
    const source = await fixture.db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, fixture.document.id),
    });
    const split = await fixture.db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, result.splitSourceDocumentId),
    });
    expect(source?.version).toBe(2);
    expect(split?.version).toBe(1);
  });

  it("shows the original's input text and images on the split document", async () => {
    const fixture = await seed();
    const files = await fixture.db
      .insert(storedFiles)
      .values(
        [0, 1].map((index) => ({
          ledgerId: fixture.ledger.id,
          storageKey: `${fixture.ledger.id}/stored/split-evidence-${index}`,
          contentType: "image/jpeg",
          byteSize: 1,
          finalizedAt: new Date(),
        }))
      )
      .returning();
    await fixture.db.insert(sourceDocumentFiles).values(
      files.map((file, position) => ({
        ledgerId: fixture.ledger.id,
        sourceDocumentId: fixture.document.id,
        storedFileId: file.id,
        position,
      }))
    );
    await fixture.db
      .update(sourceDocuments)
      .set({ inputText: "Long receipt" })
      .where(eq(sourceDocuments.id, fixture.document.id));

    const result = await splitSourceDocumentAction({
      sourceDocumentId: fixture.document.id,
      ledgerEntryIds: [fixture.ids[1]!],
      entryDate: "2026-08-16",
    });

    const fileIds = files.map((file) => file.id);
    const splitDetail = await getTargetSourceDocument(
      fixture.ledger.id,
      result.splitSourceDocumentId
    );
    expect(splitDetail).toMatchObject({ text: "Long receipt", hasImages: true });
    expect(splitDetail?.files.map((file) => file.id)).toEqual(fileIds);
    expect(splitDetail?.ledgerEntries.map((entry) => entry.id)).toEqual([fixture.ids[1]]);
    const splitInput = await getSourceDocumentInput(
      fixture.ledger.id,
      result.splitSourceDocumentId
    );
    expect(splitInput).toMatchObject({ text: "Long receipt" });
    expect(splitInput?.files.map((file) => file.id)).toEqual(fileIds);
    // The original keeps its own input as well.
    const originalDetail = await getTargetSourceDocument(fixture.ledger.id, fixture.document.id);
    expect(originalDetail).toMatchObject({ text: "Long receipt" });
    expect(originalDetail?.files.map((file) => file.id)).toEqual(fileIds);
  });

  it("rejects a repeated split once its entry has moved", async () => {
    const fixture = await seed();
    const input = {
      sourceDocumentId: fixture.document.id,
      ledgerEntryIds: [fixture.ids[0]!],
      entryDate: "2026-08-16",
    };
    await expect(splitSourceDocumentAction(input)).resolves.toMatchObject({
      movedEntryCount: 1,
    });
    await expect(splitSourceDocumentAction(input)).rejects.toThrow(/not in the source document/);
    expect(
      await fixture.db.query.sourceDocuments.findMany({
        where: eq(sourceDocuments.ledgerId, fixture.ledger.id),
      })
    ).toHaveLength(2);
  });

  it("moves an entry edited after it was selected as it is now", async () => {
    const fixture = await seed();
    await fixture.db
      .update(ledgerEntries)
      .set({ itemName: "Edited meanwhile" })
      .where(eq(ledgerEntries.id, fixture.ids[0]!));
    const result = await splitSourceDocumentAction({
      sourceDocumentId: fixture.document.id,
      ledgerEntryIds: [fixture.ids[0]!],
      entryDate: "2026-08-16",
    });
    const moved = await fixture.db.query.ledgerEntries.findFirst({
      where: eq(ledgerEntries.id, fixture.ids[0]!),
    });
    expect(moved).toMatchObject({
      sourceDocumentId: result.splitSourceDocumentId,
      itemName: "Edited meanwhile",
    });
  });

  it("rejects invalid selections without changing the document", async () => {
    const fixture = await seed();
    const input = {
      sourceDocumentId: fixture.document.id,
      ledgerEntryIds: fixture.ids,
      entryDate: "2026-08-16",
    };
    await expect(splitSourceDocumentAction(input)).rejects.toThrow(/retain at least one/);
    await expect(
      splitSourceDocumentAction({
        ...input,
        ledgerEntryIds: [crypto.randomUUID()],
      })
    ).rejects.toThrow(/not in the source document/);
    expect(
      await fixture.db.query.sourceDocuments.findFirst({
        where: eq(sourceDocuments.id, fixture.document.id),
      })
    ).toMatchObject({ version: 1 });
    expect(
      await fixture.db.query.sourceDocuments.findMany({
        where: eq(sourceDocuments.ledgerId, fixture.ledger.id),
      })
    ).toHaveLength(1);
  });

  it("serializes concurrent splits of different entries", async () => {
    const fixture = await seed();
    const results = await Promise.all(
      fixture.ids.slice(0, 2).map((id) =>
        splitSourceDocumentAction({
          sourceDocumentId: fixture.document.id,
          ledgerEntryIds: [id],
          entryDate: "2026-08-16",
        })
      )
    );
    expect(results.map((result) => result.movedEntryCount)).toEqual([1, 1]);
    expect(
      await fixture.db.query.sourceDocuments.findFirst({
        where: eq(sourceDocuments.id, fixture.document.id),
      })
    ).toMatchObject({ version: 3 });
    expect(
      await fixture.db.query.sourceDocuments.findMany({
        where: eq(sourceDocuments.ledgerId, fixture.ledger.id),
      })
    ).toHaveLength(3);
  });

  it("moves a 100-entry batch with contiguous positions", async () => {
    const fixture = await seed(101);
    const movedIds = fixture.ids.slice(0, 100);
    const result = await splitSourceDocumentAction({
      sourceDocumentId: fixture.document.id,
      ledgerEntryIds: movedIds,
      entryDate: "2026-08-16",
    });
    expect(result).toMatchObject({ movedEntryCount: 100 });

    const live = await fixture.db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.ledgerId, fixture.ledger.id));
    const splitEntries = live
      .filter((entry) => entry.sourceDocumentId === result.splitSourceDocumentId)
      .sort((left, right) => left.position - right.position);
    const retainedEntries = live.filter((entry) => entry.sourceDocumentId === fixture.document.id);
    expect(splitEntries.map((entry) => entry.id)).toEqual(movedIds);
    expect(splitEntries.map((entry) => entry.position)).toEqual(
      Array.from({ length: 100 }, (_, index) => index)
    );
    expect(retainedEntries).toHaveLength(1);
    expect(retainedEntries[0]?.position).toBe(0);
  });
});
