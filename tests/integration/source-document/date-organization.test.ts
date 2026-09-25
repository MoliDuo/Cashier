import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { ledgerEntries, sourceDocuments } from "@/persistence";
import { createTestUserWithLedger, testBookId } from "tests/helpers/schema-setup";
import { getTestDb } from "tests/setup";
import { listStreamPage as listStreamPageFor } from "@/modules/source-document/server/list-stream-page";
import {
  applyDateOrganization,
  dismissDateOrganization,
} from "@/modules/source-document/server/date-organization";
import { createManualDocument } from "@/modules/source-document/server/projections/writes";
import { addLedgerEntry } from "@/modules/source-document/server/entry-commands";

const listStreamPage = (ledgerId: string) => listStreamPageFor(ledgerId, { limit: 20 });

async function createFixture() {
  const db = getTestDb();
  const { ledgerId } = await createTestUserWithLedger(
    db,
    `date-organization-${crypto.randomUUID()}`
  );
  const created = await createManualDocument({
    ledgerId,
    bookId: await testBookId(db, ledgerId),
    title: "Long screenshot",
    entryDate: "2026-09-10",
    inputText: "Long screenshot text",
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
      eq(ledgerEntries.sourceDocumentId, created.sourceDocumentId)
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
  if (document == null) throw new Error("Live document expected");
  const entries = await db.query.ledgerEntries.findMany({
    where: and(
      eq(ledgerEntries.ledgerId, ledgerId),
      eq(ledgerEntries.sourceDocumentId, sourceDocumentId)
    ),
    orderBy: (row, { asc }) => [asc(row.position)],
  });
  return { document, names: entries.map((entry) => entry.itemName) };
}

describe("date organization", () => {
  it("keeps uncertain entries in the original bill and creates one bill per applied date", async () => {
    const fixture = await createFixture();
    const result = await applyDateOrganization({
      ledgerId: fixture.ledgerId,
      sourceDocumentId: fixture.created.sourceDocumentId,
      suggestionId: fixture.suggestionId,
      groups: [
        { id: "retain", entryDate: null, ledgerEntryIds: [fixture.entries[0]!.id] },
        { id: "2026-09-09", entryDate: "2026-09-09", ledgerEntryIds: [fixture.entries[1]!.id] },
        { id: "2026-09-08", entryDate: "2026-09-08", ledgerEntryIds: [fixture.entries[2]!.id] },
      ],
      appliedGroupIds: ["2026-09-09", "2026-09-08"],
    });

    expect(result.sourceDocument.version).toBe(2);
    expect(result.createdSourceDocumentIds).toHaveLength(2);
    const original = await activeEntryNames(fixture.ledgerId, fixture.created.sourceDocumentId);
    expect(original.document.documentDate).toBe("2026-09-10");
    expect(original.names).toEqual(["Today"]);
    const created = await Promise.all(
      result.createdSourceDocumentIds.map((id) => activeEntryNames(fixture.ledgerId, id))
    );
    expect(created.map(({ document, names }) => [document.documentDate, names])).toEqual([
      ["2026-09-09", ["Yesterday"]],
      ["2026-09-08", ["Earlier"]],
    ]);
    // Each new bill keeps the input the entries were read from, without a revision.
    expect(created.map(({ document }) => document.inputText)).toEqual([
      "Long screenshot text",
      "Long screenshot text",
    ]);
    expect(created.map(({ document }) => document.latestSubmissionRevisionId)).toEqual([
      null,
      null,
    ]);
    const stream = await listStreamPage(fixture.ledgerId);
    const createdCards = result.createdSourceDocumentIds.map((id) =>
      stream.items.find((item) => item.id === id)
    );
    expect(createdCards.map((item) => item?.ledgerEntries)).toMatchObject([
      [{ itemName: "Yesterday", amount: "2.000", convertedAmount: "2.00" }],
      [{ itemName: "Earlier", amount: "3.000", convertedAmount: "3.00" }],
    ]);
  });

  it("keeps the original id for the newest date when every entry is organized", async () => {
    const fixture = await createFixture();
    const result = await applyDateOrganization({
      ledgerId: fixture.ledgerId,
      sourceDocumentId: fixture.created.sourceDocumentId,
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

    expect(result.sourceDocument.version).toBe(2);
    expect(result.createdSourceDocumentIds).toHaveLength(1);
    const original = await activeEntryNames(fixture.ledgerId, fixture.created.sourceDocumentId);
    expect(original.document.documentDate).toBe("2026-09-09");
    expect(original.names).toEqual(["Today", "Yesterday"]);
    const older = await activeEntryNames(fixture.ledgerId, result.createdSourceDocumentIds[0]!);
    expect(older.document.documentDate).toBe("2026-09-08");
    expect(older.names).toEqual(["Earlier"]);
  });

  it("applies after an entry was added to the bill and keeps it in the original", async () => {
    const fixture = await createFixture();
    await addLedgerEntry({
      ledgerId: fixture.ledgerId,
      sourceDocumentId: fixture.created.sourceDocumentId,
      amount: "4.00",
      itemName: "Added later",
    });

    const result = await applyDateOrganization({
      ledgerId: fixture.ledgerId,
      sourceDocumentId: fixture.created.sourceDocumentId,
      suggestionId: fixture.suggestionId,
      groups: [
        { id: "2026-09-09", entryDate: "2026-09-09", ledgerEntryIds: [fixture.entries[1]!.id] },
      ],
      appliedGroupIds: ["2026-09-09"],
    });

    expect(result.sourceDocument.version).toBe(3);
    const original = await activeEntryNames(fixture.ledgerId, fixture.created.sourceDocumentId);
    expect(original.names).toEqual(["Today", "Earlier", "Added later"]);
    const moved = await activeEntryNames(fixture.ledgerId, result.createdSourceDocumentIds[0]!);
    expect(moved.names).toEqual(["Yesterday"]);
  });

  it("leaves a newer suggestion in place when an older one is dismissed", async () => {
    const fixture = await createFixture();
    const staleSuggestionId = crypto.randomUUID();

    await expect(
      dismissDateOrganization({
        ledgerId: fixture.ledgerId,
        sourceDocumentId: fixture.created.sourceDocumentId,
        suggestionId: staleSuggestionId,
      })
    ).resolves.toEqual({ dismissed: true });
    const kept = await activeEntryNames(fixture.ledgerId, fixture.created.sourceDocumentId);
    expect(kept.document.dateOrganizationSuggestion?.id).toBe(fixture.suggestionId);

    await dismissDateOrganization({
      ledgerId: fixture.ledgerId,
      sourceDocumentId: fixture.created.sourceDocumentId,
      suggestionId: fixture.suggestionId,
    });
    const dismissed = await activeEntryNames(fixture.ledgerId, fixture.created.sourceDocumentId);
    expect(dismissed.document.dateOrganizationSuggestion).toBeNull();
    expect(dismissed.document.version).toBe(1);
  });
});
