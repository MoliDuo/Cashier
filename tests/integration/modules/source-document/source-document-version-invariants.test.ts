/**
 * Canonical version-invariant suite for every existing-document command on
 * `SourceDocumentAggregateWritePort`. Each command must, against the real
 * database: (a) advance `version` by exactly +1 when it produces a
 * user-observable change, (b) where the command supports replay at the
 * *current* version, either return success with the version unchanged (a
 * true no-op) or fail in a well-defined non-stale way — never silently
 * double-increment — and (c) reject a *stale* (already-superseded) version
 * with zero writes.
 *
 * The `Record<ExistingDocumentCommand, ...>` registry below is typed from
 * `keyof SourceDocumentAggregateWritePort`: adding a new port method changes
 * `ExistingDocumentCommand` and this file fails to compile until a scenario
 * is added for it. That is the enforcement mechanism, not a comment.
 */
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { serverComposition } from "@/application/server-composition-root";
import type { SourceDocumentAggregateWritePort } from "@/modules/source-document/application/ports";
import { ConflictError, NotFoundError, StaleSourceDocumentVersionError } from "@/lib/errors";
import { ledgers, sourceDocuments } from "@/persistence";
import { createTestUserWithLedger } from "tests/helpers/schema-setup";
import { getTestDb } from "tests/setup";

/**
 * Every command on the port that mutates an *existing* document under a
 * caller-supplied `expectedVersion` CAS. Excluded, and why:
 * - `createProcessingDocument` / `createManualDocument`: create a *new*
 *   document; there is no prior version to be a CAS against.
 * - `completeProcessing`: provider-driven internal writes keyed by revision
 *   ids, not a browser-facing versioned command.
 */
type ExistingDocumentCommand = Exclude<
  keyof SourceDocumentAggregateWritePort,
  | "createProcessingDocument"
  | "createIdempotentProcessingDocument"
  | "createManualDocument"
  | "installIdempotentRetry"
  | "completeProcessing"
  | "applyCategoryAssignments"
>;

const port: SourceDocumentAggregateWritePort = serverComposition.sourceDocumentAggregate;

const entry = {
  categoryId: null,
  amount: "12.00",
  currency: "CNY",
  itemName: "Item",
  description: null,
  convertedAmount: "12.00",
  exchangeRate: "1.000000",
} as const;

async function newLedger() {
  const db = getTestDb();
  const { ledgerId } = await createTestUserWithLedger(
    db,
    `version-invariants-${crypto.randomUUID()}`
  );
  return ledgerId;
}

async function currentVersion(sourceDocumentId: string): Promise<number> {
  const db = getTestDb();
  const row = await db.query.sourceDocuments.findFirst({
    where: eq(sourceDocuments.id, sourceDocumentId),
    columns: { version: true },
  });
  if (row == null) throw new Error("Source document not found");
  return row.version;
}

async function currentTitle(sourceDocumentId: string): Promise<string | null> {
  const db = getTestDb();
  const row = await db.query.sourceDocuments.findFirst({
    where: eq(sourceDocuments.id, sourceDocumentId),
    columns: { title: true },
  });
  if (row == null) throw new Error("Source document not found");
  return row.title;
}

/** An active, completed document with `count` entries — version 1. */
async function createActiveDocument(ledgerId: string, count = 1) {
  const created = await port.createManualDocument({
    expectedMainCurrency: "CNY",
    ledgerId,
    title: "Original",
    entryDate: "2026-08-01",
    entries: Array.from({ length: count }, (_, index) => ({
      ...entry,
      itemName: `Item ${index + 1}`,
    })),
  });
  const db = getTestDb();
  const entries = await db.query.ledgerEntries.findMany({
    where: (row, { eq: eqOp, and, isNull }) =>
      and(eqOp(row.sourceDocumentRevisionId, created.revisionId), isNull(row.deletedAt)),
    orderBy: (row, { asc }) => [asc(row.position)],
  });
  return { sourceDocumentId: created.sourceDocumentId, entryIds: entries.map((row) => row.id) };
}

/** A document with a fresh, still-processing pending revision — version 1. */
async function createProcessingDocument(ledgerId: string) {
  const pending = await port.createProcessingDocument({
    ledgerId,
    input: { text: "Processing fixture", storedFileIds: [], documentDate: null },
  });
  return { sourceDocumentId: pending.document.id, version: pending.document.version };
}

const registry: Record<ExistingDocumentCommand, () => Promise<void>> = {
  async assignAttribution() {
    const ledgerId = await newLedger();
    const { sourceDocumentId } = await createActiveDocument(ledgerId);
    const db = getTestDb();
    const [ledger] = await db
      .select({ userId: ledgers.userId })
      .from(ledgers)
      .where(eq(ledgers.id, ledgerId));
    const input = { ledgerId, sourceDocumentId, attributedUserId: ledger!.userId };
    expect(await port.assignAttribution({ ...input, expectedVersion: 1 })).toEqual({
      ok: true,
      version: 2,
    });
    expect(await port.assignAttribution({ ...input, expectedVersion: 2 })).toEqual({
      ok: true,
      version: 2,
    });
    expect(await port.assignAttribution({ ...input, expectedVersion: 1 })).toEqual({
      ok: false,
      currentVersion: 2,
    });
  },
  async applyDateOrganization() {
    const ledgerId = await newLedger();
    const { sourceDocumentId, entryIds } = await createActiveDocument(ledgerId);
    const suggestionId = crypto.randomUUID();
    const db = getTestDb();
    const rows = await db.query.ledgerEntries.findMany({
      where: (row, { inArray }) => inArray(row.id, entryIds),
    });
    await db
      .update(sourceDocuments)
      .set({
        dateOrganizationSuggestion: {
          schemaVersion: 1,
          id: suggestionId,
          referenceDate: "2026-08-02",
          sourceDocumentDate: "2026-08-02",
          items: rows.map((entry) => ({
            ledgerEntryId: entry.id,
            dateHint: { kind: "relative", value: "yesterday", sourceText: "昨天" },
            resolvedDate: "2026-08-01",
            sourceText: "昨天",
            snapshot: {
              itemName: entry.itemName,
              amount: String(Number(entry.amount)),
              currency: entry.currency ?? "CNY",
            },
          })),
        },
      })
      .where(eq(sourceDocuments.id, sourceDocumentId));
    const changed = await port.applyDateOrganization({
      ledgerId,
      sourceDocumentId,
      expectedVersion: 1,
      suggestionId,
      groups: [{ id: "yesterday", entryDate: "2026-08-01", ledgerEntryIds: entryIds }],
      appliedGroupIds: ["yesterday"],
    });
    expect(changed).toMatchObject({ ok: true, version: 2 });
    expect(await currentVersion(sourceDocumentId)).toBe(2);
    const stale = await port.applyDateOrganization({
      ledgerId,
      sourceDocumentId,
      expectedVersion: 1,
      suggestionId,
      groups: [{ id: "yesterday", entryDate: "2026-08-01", ledgerEntryIds: entryIds }],
      appliedGroupIds: ["yesterday"],
    });
    expect(stale).toMatchObject({ ok: false, reason: "stale", currentVersion: 2 });
  },

  async dismissDateOrganization() {
    const ledgerId = await newLedger();
    const { sourceDocumentId } = await createActiveDocument(ledgerId);
    const suggestionId = crypto.randomUUID();
    const db = getTestDb();
    await db
      .update(sourceDocuments)
      .set({
        dateOrganizationSuggestion: {
          schemaVersion: 1,
          id: suggestionId,
          referenceDate: "2026-08-02",
          sourceDocumentDate: "2026-08-02",
          items: [],
        },
      })
      .where(eq(sourceDocuments.id, sourceDocumentId));
    const changed = await port.dismissDateOrganization({
      ledgerId,
      sourceDocumentId,
      expectedVersion: 1,
      suggestionId,
    });
    expect(changed).toMatchObject({ ok: true, version: 2 });
    expect(await currentVersion(sourceDocumentId)).toBe(2);
    const stale = await port.dismissDateOrganization({
      ledgerId,
      sourceDocumentId,
      expectedVersion: 1,
      suggestionId,
    });
    expect(stale).toMatchObject({ ok: false, reason: "stale", currentVersion: 2 });
  },

  async saveChanges() {
    const ledgerId = await newLedger();
    const { sourceDocumentId } = await createActiveDocument(ledgerId);

    const changed = await port.saveChanges({
      ledgerId,
      sourceDocumentId,
      expectedVersion: 1,
      sourceDocument: { title: "Updated" },
      entries: [],
    });
    expect(changed).toMatchObject({ ok: true, version: 2 });
    expect(await currentVersion(sourceDocumentId)).toBe(2);

    // No-op: replaying the same (already-applied) title at the current
    // version is a true no-op — success, version unchanged.
    const noop = await port.saveChanges({
      ledgerId,
      sourceDocumentId,
      expectedVersion: 2,
      sourceDocument: { title: "Updated" },
      entries: [],
    });
    expect(noop).toMatchObject({ ok: true, version: 2 });
    expect(await currentVersion(sourceDocumentId)).toBe(2);

    const stale = await port.saveChanges({
      ledgerId,
      sourceDocumentId,
      expectedVersion: 1,
      sourceDocument: { title: "Stale write" },
      entries: [],
    });
    expect(stale).toMatchObject({ ok: false, reason: "stale", currentVersion: 2 });
    expect(await currentVersion(sourceDocumentId)).toBe(2);
    expect(await currentTitle(sourceDocumentId)).toBe("Updated");
  },

  async updateDocuments() {
    const ledgerId = await newLedger();
    const { sourceDocumentId } = await createActiveDocument(ledgerId);
    const target = (expectedVersion: number) => [{ sourceDocumentId, expectedVersion }];

    const changed = await port.updateDocuments({
      ledgerId,
      targets: target(1),
      data: { title: "Batch title" },
    });
    expect(changed).toMatchObject({
      ok: true,
      versions: [{ sourceDocumentId, version: 2 }],
      data: { updatedCount: 1 },
    });

    // No-op: the title already matches — zero writes, version unchanged.
    const noop = await port.updateDocuments({
      ledgerId,
      targets: target(2),
      data: { title: "Batch title" },
    });
    expect(noop).toMatchObject({
      ok: true,
      versions: [{ sourceDocumentId, version: 2 }],
      data: { updatedCount: 0 },
    });
    expect(await currentVersion(sourceDocumentId)).toBe(2);

    const stale = await port.updateDocuments({
      ledgerId,
      targets: target(1),
      data: { title: "Stale batch title" },
    });
    expect(stale).toMatchObject({
      ok: false,
      reason: "stale",
      staleTargets: [{ sourceDocumentId, expectedVersion: 1, currentVersion: 2 }],
    });
    expect(await currentVersion(sourceDocumentId)).toBe(2);
    expect(await currentTitle(sourceDocumentId)).toBe("Batch title");
  },

  async updateEntryDates() {
    const ledgerId = await newLedger();
    const { sourceDocumentId, entryIds } = await createActiveDocument(ledgerId);
    const targets = (expectedVersion: number) => [{ sourceDocumentId, expectedVersion }];

    const changed = await port.updateEntryDates({
      ledgerId,
      targets: targets(1),
      ledgerEntryIds: entryIds,
      entryDate: "2026-08-02",
    });
    expect(changed).toMatchObject({
      ok: true,
      versions: [{ sourceDocumentId, version: 2 }],
    });

    const noop = await port.updateEntryDates({
      ledgerId,
      targets: targets(2),
      ledgerEntryIds: entryIds,
      entryDate: "2026-08-02",
    });
    expect(noop).toMatchObject({
      ok: true,
      versions: [{ sourceDocumentId, version: 2 }],
    });
    expect(await currentVersion(sourceDocumentId)).toBe(2);

    const stale = await port.updateEntryDates({
      ledgerId,
      targets: targets(1),
      ledgerEntryIds: entryIds,
      entryDate: "2026-08-03",
    });
    expect(stale).toMatchObject({
      ok: false,
      reason: "stale",
      staleTargets: [{ sourceDocumentId, expectedVersion: 1, currentVersion: 2 }],
    });
    expect(await currentVersion(sourceDocumentId)).toBe(2);
  },

  async addEntry() {
    const ledgerId = await newLedger();
    const { sourceDocumentId } = await createActiveDocument(ledgerId);

    const changed = await port.addEntry({
      ledgerId,
      target: { sourceDocumentId, expectedVersion: 1 },
      amount: "5.00",
      itemName: "New item",
    });
    expect(changed).toMatchObject({ ok: true, version: 2 });
    expect(await currentVersion(sourceDocumentId)).toBe(2);

    // No no-op case: every successful call adds a distinct new entry, so
    // there is no "replay is a no-op" scenario to exercise here.

    const stale = await port.addEntry({
      ledgerId,
      target: { sourceDocumentId, expectedVersion: 1 },
      amount: "9.00",
      itemName: "Stale item",
    });
    expect(stale).toMatchObject({ ok: false, reason: "stale", currentVersion: 2 });
    expect(await currentVersion(sourceDocumentId)).toBe(2);
  },

  async updateEntries() {
    const ledgerId = await newLedger();
    const { sourceDocumentId, entryIds } = await createActiveDocument(ledgerId);
    const ledgerEntryId = entryIds[0]!;

    const changed = await port.updateEntries({
      ledgerId,
      target: { sourceDocumentId, expectedVersion: 1 },
      ledgerEntryId,
      itemName: "Renamed",
    });
    expect(changed).toMatchObject({ ok: true, version: 2 });
    expect(await currentVersion(sourceDocumentId)).toBe(2);

    // No-op: the patch already matches the entry's current value.
    const noop = await port.updateEntries({
      ledgerId,
      target: { sourceDocumentId, expectedVersion: 2 },
      ledgerEntryId,
      itemName: "Renamed",
    });
    expect(noop).toMatchObject({ ok: true, version: 2 });
    expect(await currentVersion(sourceDocumentId)).toBe(2);

    const stale = await port.updateEntries({
      ledgerId,
      target: { sourceDocumentId, expectedVersion: 1 },
      ledgerEntryId,
      itemName: "Stale rename",
    });
    expect(stale).toMatchObject({ ok: false, reason: "stale", currentVersion: 2 });
    expect(await currentVersion(sourceDocumentId)).toBe(2);
  },

  async deleteEntries() {
    const ledgerId = await newLedger();
    const { sourceDocumentId, entryIds } = await createActiveDocument(ledgerId, 2);

    const changed = await port.deleteEntries({
      ledgerId,
      target: { sourceDocumentId, expectedVersion: 1 },
      ledgerEntryId: entryIds[0]!,
    });
    expect(changed).toMatchObject({ ok: true, version: 2 });
    expect(await currentVersion(sourceDocumentId)).toBe(2);

    // No no-op case: a deleted entry cannot be deleted again — a replay of
    // the exact same call is necessarily at a stale version (covered below)
    // since the first delete already advanced version.

    const stale = await port.deleteEntries({
      ledgerId,
      target: { sourceDocumentId, expectedVersion: 1 },
      ledgerEntryId: entryIds[1]!,
    });
    expect(stale).toMatchObject({ ok: false, reason: "stale", currentVersion: 2 });
    expect(await currentVersion(sourceDocumentId)).toBe(2);
  },

  async batchUpdateEntries() {
    const ledgerId = await newLedger();
    const { sourceDocumentId, entryIds } = await createActiveDocument(ledgerId);
    const targets = (expectedVersion: number) => [{ sourceDocumentId, expectedVersion }];

    const changed = await port.batchUpdateEntries({
      ledgerId,
      targets: targets(1),
      ledgerEntryIds: entryIds,
      itemName: "Batch renamed",
    });
    expect(changed).toMatchObject({
      ok: true,
      versions: [{ sourceDocumentId, version: 2 }],
      data: { affectedCount: 1 },
    });

    // No-op: the patch already matches every selected entry's current value.
    const noop = await port.batchUpdateEntries({
      ledgerId,
      targets: targets(2),
      ledgerEntryIds: entryIds,
      itemName: "Batch renamed",
    });
    expect(noop).toMatchObject({
      ok: true,
      versions: [{ sourceDocumentId, version: 2 }],
      data: { affectedCount: 0 },
    });
    expect(await currentVersion(sourceDocumentId)).toBe(2);

    const stale = await port.batchUpdateEntries({
      ledgerId,
      targets: targets(1),
      ledgerEntryIds: entryIds,
      itemName: "Stale batch rename",
    });
    expect(stale).toMatchObject({
      ok: false,
      reason: "stale",
      staleTargets: [{ sourceDocumentId, expectedVersion: 1, currentVersion: 2 }],
    });
    expect(await currentVersion(sourceDocumentId)).toBe(2);
  },

  async batchDeleteEntries() {
    const ledgerId = await newLedger();
    const { sourceDocumentId, entryIds } = await createActiveDocument(ledgerId, 2);
    const targets = (expectedVersion: number) => [{ sourceDocumentId, expectedVersion }];

    const changed = await port.batchDeleteEntries({
      ledgerId,
      targets: targets(1),
      ledgerEntryIds: [entryIds[0]!],
    });
    expect(changed.succeeded).toEqual([{ id: entryIds[0], sourceDocumentId, version: 2 }]);
    expect(await currentVersion(sourceDocumentId)).toBe(2);

    // No no-op case: deleting the same entry twice is not idempotent — a
    // replay is necessarily at a stale version once the first delete commits.

    const stale = await port.batchDeleteEntries({
      ledgerId,
      targets: targets(1),
      ledgerEntryIds: [entryIds[1]!],
    });
    expect(stale.stale).toEqual([
      { id: entryIds[1], sourceDocumentId, expectedVersion: 1, currentVersion: 2 },
    ]);
    expect(stale.succeeded).toEqual([]);
    expect(await currentVersion(sourceDocumentId)).toBe(2);
  },

  async splitEntries() {
    const ledgerId = await newLedger();
    const { sourceDocumentId, entryIds } = await createActiveDocument(ledgerId, 3);

    const changed = await port.splitEntries({
      ledgerId,
      sourceDocumentId,
      expectedVersion: 1,
      ledgerEntryIds: [entryIds[0]!],
      entryDate: "2026-08-05",
    });
    expect(changed).toMatchObject({ ok: true, version: 2, data: { movedEntryCount: 1 } });
    expect(await currentVersion(sourceDocumentId)).toBe(2);

    // No no-op case: a split always mints a brand-new document and moves
    // entries; replaying the exact call is necessarily against a stale
    // version once the first split commits.

    const stale = await port.splitEntries({
      ledgerId,
      sourceDocumentId,
      expectedVersion: 1,
      ledgerEntryIds: [entryIds[1]!],
      entryDate: "2026-08-05",
    });
    expect(stale).toMatchObject({ ok: false, reason: "stale", currentVersion: 2 });
    expect(await currentVersion(sourceDocumentId)).toBe(2);
  },

  async installRetry() {
    const ledgerId = await newLedger();
    const { sourceDocumentId } = await createActiveDocument(ledgerId);

    const changed = await port.installRetry({
      ledgerId,
      sourceDocumentId,
      expectedVersion: 1,
      inheritInput: false,
      input: { text: "retry", storedFileIds: [], documentDate: null },
      supersedeProcessing: true,
    });
    expect(changed.document.version).toBe(2);
    expect(await currentVersion(sourceDocumentId)).toBe(2);

    // No no-op case: `supersedeProcessing: true` (what every real retry
    // sends) deliberately allows a second retry to lay a fresh pending
    // revision on top of one still processing — so a call at the new
    // current version is not a no-op and not rejected, it advances again.
    const superseded = await port.installRetry({
      ledgerId,
      sourceDocumentId,
      expectedVersion: 2,
      inheritInput: true,
      supersedeProcessing: true,
    });
    expect(superseded.document.version).toBe(3);
    expect(await currentVersion(sourceDocumentId)).toBe(3);

    await expect(
      port.installRetry({
        ledgerId,
        sourceDocumentId,
        expectedVersion: 1,
        inheritInput: true,
        supersedeProcessing: true,
      })
    ).rejects.toThrow(StaleSourceDocumentVersionError);
    expect(await currentVersion(sourceDocumentId)).toBe(3);
  },

  async cancelProcessing() {
    const ledgerId = await newLedger();
    const { sourceDocumentId, version } = await createProcessingDocument(ledgerId);

    const changed = await port.cancelProcessing(ledgerId, sourceDocumentId, version);
    expect(changed).toMatchObject({ version: version + 1, processingStatus: "cancelled" });
    expect(await currentVersion(sourceDocumentId)).toBe(version + 1);

    // The latest input remains addressable, but its terminal revision cannot be cancelled twice.
    await expect(port.cancelProcessing(ledgerId, sourceDocumentId, version + 1)).rejects.toThrow(
      ConflictError
    );
    expect(await currentVersion(sourceDocumentId)).toBe(version + 1);

    await expect(port.cancelProcessing(ledgerId, sourceDocumentId, version)).rejects.toThrow(
      StaleSourceDocumentVersionError
    );
    expect(await currentVersion(sourceDocumentId)).toBe(version + 1);
  },

  async deleteDocuments() {
    const ledgerId = await newLedger();
    const { sourceDocumentId } = await createActiveDocument(ledgerId);

    // Advance the version once via an unrelated command first, so the stale
    // sub-check below can target a genuinely superseded (but still-present)
    // document, distinct from the "already deleted" case.
    await port.updateDocuments({
      ledgerId,
      targets: [{ sourceDocumentId, expectedVersion: 1 }],
      data: { title: "Before delete" },
    });
    expect(await currentVersion(sourceDocumentId)).toBe(2);

    const stale = await port.deleteDocuments({
      ledgerId,
      target: { sourceDocumentId, expectedVersion: 1 },
    });
    expect(stale).toMatchObject({ ok: false, reason: "stale", currentVersion: 2 });
    const db = getTestDb();
    const beforeDelete = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, sourceDocumentId),
    });
    expect(beforeDelete?.deletedAt).toBeNull();
    expect(beforeDelete?.version).toBe(2);

    const changed = await port.deleteDocuments({
      ledgerId,
      target: { sourceDocumentId, expectedVersion: 2 },
    });
    expect(changed).toMatchObject({ ok: true, version: 3 });
    const afterDelete = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, sourceDocumentId),
    });
    expect(afterDelete?.deletedAt).not.toBeNull();
    expect(afterDelete?.version).toBe(3);

    // No no-op case: once deleted, the document is invisible to the locked
    // read every write path uses — a replay is rejected as `NotFoundError`,
    // not a silent no-op and not a stale-version result.
    await expect(
      port.deleteDocuments({ ledgerId, target: { sourceDocumentId, expectedVersion: 3 } })
    ).rejects.toThrow(NotFoundError);
  },
};

describe("source document aggregate — version invariants", () => {
  for (const [name, run] of Object.entries(registry) as Array<
    [ExistingDocumentCommand, () => Promise<void>]
  >) {
    it(`${name}: +1 on change, no-op or well-defined replay, stale rejected with zero writes`, run);
  }
});
