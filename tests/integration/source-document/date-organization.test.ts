import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { serverComposition } from "@/application/server-composition-root";
import { ledgerEntries, sourceDocuments } from "@/persistence";
import { listStreamPage as listStreamPageUseCase } from "@/modules/source-document/application/queries/list-stream-page";
import { createTestUserWithLedger } from "tests/helpers/schema-setup";
import { getTestDb } from "tests/setup";

const port = serverComposition.sourceDocumentAggregate;
const queryPorts = {
  documents: serverComposition.sourceDocumentReads,
  ledgerReads: serverComposition.ledgerReads,
  changes: serverComposition.ledgerChanges,
};

const listStreamPage = (ledgerId: string) =>
  listStreamPageUseCase(ledgerId, { limit: 20 }, queryPorts);

async function createFixture() {
  const db = getTestDb();
  const { ledgerId } = await createTestUserWithLedger(
    db,
    `date-organization-${crypto.randomUUID()}`
  );
  const created = await port.createManualDocument({
    ledgerId,
    attributedUserId: process.env.COUPLE_OWNER_USER_ID!,
    createdByUserId: process.env.COUPLE_OWNER_USER_ID!,
    expectedMainCurrency: "CNY",
    title: "Long screenshot",
    entryDate: "2026-09-10",
    entries: ["Today", "Yesterday", "Earlier"].map((itemName, index) => ({
      categoryId: null,
      amount: `${index + 1}.00`,
      currency: "CNY",
      itemName,
      description: null,
      convertedAmount: `${index + 1}.00`,
      exchangeRate: "1",
    })),
  });
  const entries = await db.query.ledgerEntries.findMany({
    where: and(
      eq(ledgerEntries.ledgerId, ledgerId),
      eq(ledgerEntries.sourceDocumentId, created.sourceDocumentId),
      eq(ledgerEntries.sourceDocumentRevisionId, created.revisionId),
      isNull(ledgerEntries.deletedAt)
    ),
    orderBy: (row, { asc }) => [asc(row.position)],
  });
  const suggestionId = crypto.randomUUID();
  await db
    .update(sourceDocuments)
    .set({
      dateOrganizationSuggestion: {
        schemaVersion: 1,
        id: suggestionId,
        referenceDate: "2026-09-10",
        sourceDocumentDate: "2026-09-10",
        items: entries.slice(1).map((entry, index) => ({
          ledgerEntryId: entry.id,
          dateHint: {
            kind: "relative" as const,
            value: index === 0 ? "yesterday" : "day_before_yesterday",
            sourceText: index === 0 ? "昨天" : "前天",
          },
          resolvedDate: index === 0 ? "2026-09-09" : "2026-09-08",
          sourceText: index === 0 ? "昨天" : "前天",
          snapshot: {
            itemName: entry.itemName,
            amount: String(Number(entry.amount)),
            currency: entry.currency ?? "CNY",
          },
        })),
      },
    })
    .where(eq(sourceDocuments.id, created.sourceDocumentId));
  return { db, ledgerId, created, entries, suggestionId };
}

async function activeEntryNames(ledgerId: string, sourceDocumentId: string) {
  const db = getTestDb();
  const document = await db.query.sourceDocuments.findFirst({
    where: and(eq(sourceDocuments.ledgerId, ledgerId), eq(sourceDocuments.id, sourceDocumentId)),
  });
  if (document?.activeRevisionId == null) throw new Error("Active document expected");
  const entries = await db.query.ledgerEntries.findMany({
    where: and(
      eq(ledgerEntries.ledgerId, ledgerId),
      eq(ledgerEntries.sourceDocumentId, sourceDocumentId),
      eq(ledgerEntries.sourceDocumentRevisionId, document.activeRevisionId),
      isNull(ledgerEntries.deletedAt)
    ),
    orderBy: (row, { asc }) => [asc(row.position)],
  });
  return { document, names: entries.map((entry) => entry.itemName) };
}

describe("date organization", () => {
  it("keeps uncertain entries in the original bill and creates one bill per applied date", async () => {
    const fixture = await createFixture();
    const result = await port.applyDateOrganization({
      ledgerId: fixture.ledgerId,
      sourceDocumentId: fixture.created.sourceDocumentId,
      expectedVersion: 1,
      suggestionId: fixture.suggestionId,
      groups: [
        { id: "retain", entryDate: null, ledgerEntryIds: [fixture.entries[0]!.id] },
        { id: "2026-09-09", entryDate: "2026-09-09", ledgerEntryIds: [fixture.entries[1]!.id] },
        { id: "2026-09-08", entryDate: "2026-09-08", ledgerEntryIds: [fixture.entries[2]!.id] },
      ],
      appliedGroupIds: ["2026-09-09", "2026-09-08"],
    });

    expect(result).toMatchObject({ ok: true, version: 2 });
    if (!result.ok) throw new Error("Expected date organization to succeed");
    expect(result.data.createdSourceDocumentIds).toHaveLength(2);
    const original = await activeEntryNames(fixture.ledgerId, fixture.created.sourceDocumentId);
    expect(original.document.documentDate).toBe("2026-09-10");
    expect(original.names).toEqual(["Today"]);
    const created = await Promise.all(
      result.data.createdSourceDocumentIds.map((id) => activeEntryNames(fixture.ledgerId, id))
    );
    expect(created.map(({ document, names }) => [document.documentDate, names])).toEqual([
      ["2026-09-09", ["Yesterday"]],
      ["2026-09-08", ["Earlier"]],
    ]);
    const stream = await listStreamPage(fixture.ledgerId);
    const createdCards = result.data.createdSourceDocumentIds.map((id) =>
      stream.items.find((item) => item.id === id)
    );
    expect(createdCards.map((item) => item?.ledgerEntries)).toMatchObject([
      [{ itemName: "Yesterday", amount: "2.000", convertedAmount: "2.000" }],
      [{ itemName: "Earlier", amount: "3.000", convertedAmount: "3.000" }],
    ]);
  });

  it("keeps the original id for the newest date when every entry is organized", async () => {
    const fixture = await createFixture();
    const result = await port.applyDateOrganization({
      ledgerId: fixture.ledgerId,
      sourceDocumentId: fixture.created.sourceDocumentId,
      expectedVersion: 1,
      suggestionId: fixture.suggestionId,
      groups: [
        {
          id: "2026-09-09",
          entryDate: "2026-09-09",
          ledgerEntryIds: [fixture.entries[0]!.id, fixture.entries[1]!.id],
        },
        { id: "2026-09-08", entryDate: "2026-09-08", ledgerEntryIds: [fixture.entries[2]!.id] },
      ],
      appliedGroupIds: ["2026-09-09", "2026-09-08"],
    });

    expect(result).toMatchObject({ ok: true, version: 2 });
    if (!result.ok) throw new Error("Expected date organization to succeed");
    expect(result.data.createdSourceDocumentIds).toHaveLength(1);
    const original = await activeEntryNames(fixture.ledgerId, fixture.created.sourceDocumentId);
    expect(original.document.documentDate).toBe("2026-09-09");
    expect(original.names).toEqual(["Today", "Yesterday"]);
    const older = await activeEntryNames(
      fixture.ledgerId,
      result.data.createdSourceDocumentIds[0]!
    );
    expect(older.document.documentDate).toBe("2026-09-08");
    expect(older.names).toEqual(["Earlier"]);
  });
});
