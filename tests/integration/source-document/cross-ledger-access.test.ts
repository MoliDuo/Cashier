import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getTestDb } from "../../setup";
import {
  createTestSourceDocument,
  createTestUserWithLedger,
  testBookId,
} from "../../helpers/schema-setup";
import { ledgerEntries, sourceDocuments } from "@/persistence";
import { postgresSourceDocumentAggregateAdapter as aggregate } from "@/application/adapters/postgres/source-document-aggregate";

/**
 * Every write that changes a document takes a `ledgerId` beside the record ids,
 * and it is the only thing standing between a caller and somebody else's
 * record. The server actions cannot be used to prove that: this deployment runs
 * one live ledger, so `requireLedgerAccess` refuses everything as soon as a
 * second one exists, and a test written against the actions would pass without
 * the scoping ever being consulted. The aggregate is where the scoping lives,
 * so that is where it is held.
 *
 * Each case is asserted twice: that nothing came back as though the record were
 * the caller's, and that the record is byte-for-byte as it was. An operation
 * that reports failure after writing is still a breach.
 */
interface Neighbour {
  ledgerId: string;
  sourceDocumentId: string;
  ledgerEntryId: string;
  bookId: string;
  version: number;
}

async function seedTwoLedgers(): Promise<{
  callerLedgerId: string;
  callerBookId: string;
  other: Neighbour;
}> {
  const db = getTestDb();
  const { ledgerId: callerLedgerId } = await createTestUserWithLedger(
    db,
    `caller-${crypto.randomUUID()}@example.com`,
    undefined,
    crypto.randomUUID()
  );
  const { ledgerId } = await createTestUserWithLedger(
    db,
    `neighbour-${crypto.randomUUID()}@example.com`,
    undefined,
    crypto.randomUUID()
  );
  const sourceDocumentId = await createTestSourceDocument(db, ledgerId, { title: "Their receipt" });
  const [entry] = await db
    .insert(ledgerEntries)
    .values({
      ledgerId,
      sourceDocumentId,
      amount: "42.00",
      currency: "CNY",
      itemName: "Their lunch",
    })
    .returning();
  if (entry == null) throw new Error("Expected the neighbour's ledger entry");
  const document = await db.query.sourceDocuments.findFirst({
    where: eq(sourceDocuments.id, sourceDocumentId),
  });
  if (document == null) throw new Error("Expected the neighbour's source document");
  return {
    callerLedgerId,
    callerBookId: await testBookId(db, callerLedgerId),
    other: {
      ledgerId,
      sourceDocumentId,
      ledgerEntryId: entry.id,
      bookId: await testBookId(db, ledgerId),
      version: document.version,
    },
  };
}

/** Everything about the neighbour's record that a write could disturb. */
async function snapshot(other: Neighbour) {
  const db = getTestDb();
  const document = await db.query.sourceDocuments.findFirst({
    where: eq(sourceDocuments.id, other.sourceDocumentId),
  });
  const entries = await db.query.ledgerEntries.findMany({
    where: and(
      eq(ledgerEntries.sourceDocumentId, other.sourceDocumentId),
      eq(ledgerEntries.ledgerId, other.ledgerId)
    ),
  });
  return {
    version: document?.version ?? null,
    title: document?.title ?? null,
    bookId: document?.bookId ?? null,
    deletedAt: document?.deletedAt ?? null,
    documentDate: document?.documentDate ?? null,
    entries: entries.map((entry) => ({
      id: entry.id,
      amount: entry.amount,
      itemName: entry.itemName,
      categoryId: entry.categoryId,
      deletedAt: entry.deletedAt,
    })),
  };
}

type Reach = (callerLedgerId: string, other: Neighbour, callerBookId: string) => Promise<unknown>;

const REACHES: Array<[name: string, reach: Reach]> = [
  [
    "assignBook",
    (ledgerId, other, callerBookId) =>
      aggregate.assignBook({
        ledgerId,
        sourceDocumentId: other.sourceDocumentId,
        expectedVersion: other.version,
        bookId: callerBookId,
      }),
  ],
  [
    "deleteDocuments",
    (ledgerId, other) =>
      aggregate.deleteDocuments({
        ledgerId,
        target: { sourceDocumentId: other.sourceDocumentId, expectedVersion: other.version },
      }),
  ],
  [
    "cancelProcessing",
    (ledgerId, other) =>
      aggregate.cancelProcessing(ledgerId, other.sourceDocumentId, other.version),
  ],
  [
    "updateDocuments",
    (ledgerId, other) =>
      aggregate.updateDocuments({
        ledgerId,
        targets: [{ sourceDocumentId: other.sourceDocumentId, expectedVersion: other.version }],
        data: { title: "Taken over" },
      }),
  ],
  [
    "saveChanges",
    (ledgerId, other) =>
      aggregate.saveChanges({
        ledgerId,
        sourceDocumentId: other.sourceDocumentId,
        expectedVersion: other.version,
        sourceDocument: { title: "Taken over" },
        entries: [{ ledgerEntryId: other.ledgerEntryId, data: { itemName: "Taken over" } }],
      }),
  ],
  [
    "splitEntries",
    (ledgerId, other) =>
      aggregate.splitEntries({
        ledgerId,
        sourceDocumentId: other.sourceDocumentId,
        expectedVersion: other.version,
        ledgerEntryIds: [other.ledgerEntryId],
        entryDate: "2026-01-02",
      }),
  ],
  [
    "updateEntryDates",
    (ledgerId, other) =>
      aggregate.updateEntryDates({
        ledgerId,
        targets: [{ sourceDocumentId: other.sourceDocumentId, expectedVersion: other.version }],
        ledgerEntryIds: [other.ledgerEntryId],
        entryDate: "2026-01-02",
      }),
  ],
  [
    "dismissDateOrganization",
    (ledgerId, other) =>
      aggregate.dismissDateOrganization({
        ledgerId,
        sourceDocumentId: other.sourceDocumentId,
        expectedVersion: other.version,
        suggestionId: crypto.randomUUID(),
      }),
  ],
  [
    "applyDateOrganization",
    (ledgerId, other) =>
      aggregate.applyDateOrganization({
        ledgerId,
        sourceDocumentId: other.sourceDocumentId,
        expectedVersion: other.version,
        suggestionId: crypto.randomUUID(),
        groups: [{ id: "group-1", entryDate: "2026-01-02", ledgerEntryIds: [other.ledgerEntryId] }],
        appliedGroupIds: ["group-1"],
      }),
  ],
  [
    "updateEntries",
    (ledgerId, other) =>
      aggregate.updateEntries({
        ledgerId,
        target: { sourceDocumentId: other.sourceDocumentId, expectedVersion: other.version },
        ledgerEntryId: other.ledgerEntryId,
        itemName: "Taken over",
      }),
  ],
  [
    "deleteEntries",
    (ledgerId, other) =>
      aggregate.deleteEntries({
        ledgerId,
        target: { sourceDocumentId: other.sourceDocumentId, expectedVersion: other.version },
        ledgerEntryId: other.ledgerEntryId,
      }),
  ],
  [
    "batchUpdateEntries",
    (ledgerId, other) =>
      aggregate.batchUpdateEntries({
        ledgerId,
        targets: [{ sourceDocumentId: other.sourceDocumentId, expectedVersion: other.version }],
        ledgerEntryIds: [other.ledgerEntryId],
        itemName: "Taken over",
      }),
  ],
  [
    "batchDeleteEntries",
    (ledgerId, other) =>
      aggregate.batchDeleteEntries({
        ledgerId,
        targets: [{ sourceDocumentId: other.sourceDocumentId, expectedVersion: other.version }],
        ledgerEntryIds: [other.ledgerEntryId],
      }),
  ],
  [
    "installRetry",
    (ledgerId, other) =>
      aggregate.installRetry({
        ledgerId,
        sourceDocumentId: other.sourceDocumentId,
        expectedVersion: other.version,
        input: { text: "rewritten", storedFileIds: [], documentDate: null },
      }),
  ],
];

describe("the aggregate refuses a record from another ledger", () => {
  for (const [name, reach] of REACHES) {
    it(`${name} will not act on a record the ledger does not own`, async () => {
      const { callerLedgerId, callerBookId, other } = await seedTwoLedgers();
      const before = await snapshot(other);

      const outcome = await reach(callerLedgerId, other, callerBookId).then(
        (value) => ({ kind: "returned" as const, value }),
        () => ({ kind: "threw" as const, value: undefined })
      );

      // Refusal comes back in three shapes: a throw, a versioned result with
      // `ok: false`, and a partial batch that succeeded at nothing. None of
      // them may answer as though the record were the caller's.
      if (outcome.kind === "returned") {
        const value = outcome.value as { ok?: boolean; succeeded?: unknown[] } | null;
        const refused =
          value == null ||
          value.ok === false ||
          (Array.isArray(value.succeeded) && value.succeeded.length === 0);
        expect({ name, refused, answer: value }).toEqual({
          name,
          refused: true,
          answer: value,
        });
      }

      expect({ name, after: await snapshot(other) }).toEqual({ name, after: before });
    });
  }
});
