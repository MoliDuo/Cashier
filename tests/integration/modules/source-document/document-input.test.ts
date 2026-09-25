/**
 * The document carries its current input — text on the row, files in
 * `source_document_files` — alongside the revision copies it replaces. Every
 * write that changes which input a document reads keeps the two in step.
 */
import { describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import {
  ledgerSyncState,
  sourceDocumentFiles,
  sourceDocumentRevisions,
  sourceDocuments,
  storedFiles,
} from "@/persistence";
import { createTestUserWithLedger, testBookId } from "tests/helpers/schema-setup";
import { getTestDb, getTestPool } from "tests/setup";
import { submitSourceDocument } from "@/modules/source-document/server/submissions";
import { createManualDocument } from "@/modules/source-document/server/projections/writes";
import { splitSourceDocumentAtomically } from "@/modules/source-document/server/split";
import { scanUnreferencedFiles } from "../../../../scripts/prune-storage.mjs";

const entry = {
  categoryId: null,
  amount: "12.00",
  currency: "CNY",
  itemName: "Item",
  description: null,
} as const;

async function newLedger() {
  const { ledgerId } = await createTestUserWithLedger(
    getTestDb(),
    `document-input-${crypto.randomUUID()}`
  );
  return ledgerId;
}

async function storeFile(ledgerId: string) {
  const [file] = await getTestDb()
    .insert(storedFiles)
    .values({
      ledgerId,
      storageKey: `${ledgerId}/stored/${crypto.randomUUID()}`,
      contentType: "image/jpeg",
      byteSize: 7,
      finalizedAt: new Date(),
    })
    .returning();
  return file!.id;
}

async function documentInput(sourceDocumentId: string) {
  const db = getTestDb();
  const document = await db.query.sourceDocuments.findFirst({
    where: eq(sourceDocuments.id, sourceDocumentId),
    columns: { inputText: true },
  });
  const files = await db
    .select({ id: sourceDocumentFiles.storedFileId })
    .from(sourceDocumentFiles)
    .where(eq(sourceDocumentFiles.sourceDocumentId, sourceDocumentId))
    .orderBy(asc(sourceDocumentFiles.position));
  return { text: document?.inputText ?? null, fileIds: files.map((file) => file.id) };
}

async function syncVersion(ledgerId: string) {
  const row = await getTestDb().query.ledgerSyncState.findFirst({
    where: eq(ledgerSyncState.ledgerId, ledgerId),
    columns: { version: true },
  });
  return row?.version;
}

describe("source document input", () => {
  it("follows each submission: a first upload, an inherited retry, and an edited retry", async () => {
    const ledgerId = await newLedger();
    const [first, second, replacement] = await Promise.all([
      storeFile(ledgerId),
      storeFile(ledgerId),
      storeFile(ledgerId),
    ]);

    const submitted = await submitSourceDocument({
      ledgerId,
      bookId: await testBookId(getTestDb(), ledgerId),
      input: { text: "Receipt", storedFileIds: [second, first], documentDate: null },
    });
    const sourceDocumentId = submitted.document.id;
    expect(await documentInput(sourceDocumentId)).toEqual({
      text: "Receipt",
      fileIds: [second, first],
    });

    await submitSourceDocument({
      ledgerId,
      sourceDocumentId,
      inheritInput: true,
      supersedeProcessing: true,
    });
    expect(await documentInput(sourceDocumentId)).toEqual({
      text: "Receipt",
      fileIds: [second, first],
    });

    await submitSourceDocument({
      ledgerId,
      sourceDocumentId,
      inheritInput: false,
      input: { text: "Edited", storedFileIds: [replacement], documentDate: null },
      supersedeProcessing: true,
    });
    expect(await documentInput(sourceDocumentId)).toEqual({
      text: "Edited",
      fileIds: [replacement],
    });
  });

  it("gives a record typed in by hand and the bill split from it the same input", async () => {
    const ledgerId = await newLedger();
    const created = await createManualDocument({
      ledgerId,
      bookId: await testBookId(getTestDb(), ledgerId),
      inputText: "Typed by hand",
      entries: [entry, { ...entry, itemName: "Second" }],
    });
    expect(await documentInput(created.sourceDocumentId)).toEqual({
      text: "Typed by hand",
      fileIds: [],
    });

    const entries = await getTestDb().query.ledgerEntries.findMany({
      where: (row, { eq: eqOp }) => eqOp(row.sourceDocumentId, created.sourceDocumentId),
      orderBy: (row, { asc: ascending }) => [ascending(row.position)],
    });
    const split = await splitSourceDocumentAtomically({
      ledgerId,
      sourceDocumentId: created.sourceDocumentId,
      ledgerEntryIds: [entries[1]!.id],
      entryDate: "2026-08-05",
    });
    expect(await documentInput(split.splitSourceDocumentId)).toEqual({
      text: "Typed by hand",
      fileIds: [],
    });
  });

  it("keeps a file only the document lists out of the unreferenced-file prune", async () => {
    const ledgerId = await newLedger();
    const [listed, orphan] = await Promise.all([storeFile(ledgerId), storeFile(ledgerId)]);
    const created = await createManualDocument({
      ledgerId,
      bookId: await testBookId(getTestDb(), ledgerId),
      entries: [entry],
    });
    await getTestDb().insert(sourceDocumentFiles).values({
      ledgerId,
      sourceDocumentId: created.sourceDocumentId,
      storedFileId: listed,
      position: 0,
    });

    const seen: string[] = [];
    const s3 = {
      send: async (command: { input: { Key: string } }) => {
        seen.push(command.input.Key);
        return { ContentLength: 7 };
      },
    };
    const summary = {
      unreferencedFiles: {
        count: 0,
        bytes: 0,
        deleted: 0,
        deletedBytes: 0,
        failed: 0,
        missing: 0,
        missingBytes: 0,
      },
      missingObjects: { count: 0, bytes: 0 },
      errors: [] as string[],
    };
    await scanUnreferencedFiles(
      getTestPool(),
      s3,
      "fixture",
      new Date(Date.now() + 60_000),
      50,
      false,
      summary
    );
    const keys = await getTestDb()
      .select({ id: storedFiles.id, key: storedFiles.storageKey })
      .from(storedFiles)
      .where(eq(storedFiles.ledgerId, ledgerId));
    const keyById = new Map(keys.map((row) => [row.id, row.key]));
    expect(seen).toContain(keyById.get(orphan));
    expect(seen).not.toContain(keyById.get(listed));
  });

  it("leaves the ledger sync version alone when only a processing lease moves", async () => {
    const ledgerId = await newLedger();
    const submitted = await submitSourceDocument({
      ledgerId,
      bookId: await testBookId(getTestDb(), ledgerId),
      input: { text: "Receipt", storedFileIds: [], documentDate: null },
    });
    const revisionId = submitted.revision.id;
    const db = getTestDb();
    const before = await syncVersion(ledgerId);

    await db
      .update(sourceDocumentRevisions)
      .set({
        claimToken: crypto.randomUUID(),
        claimExpiresAt: new Date(Date.now() + 15_000),
        attemptCount: 1,
        nextAvailableAt: new Date(Date.now() + 60_000),
      })
      .where(eq(sourceDocumentRevisions.id, revisionId));
    expect(await syncVersion(ledgerId)).toBe(before);

    await db
      .update(sourceDocumentRevisions)
      .set({ processingStatus: "cancelled", finishedAt: new Date() })
      .where(eq(sourceDocumentRevisions.id, revisionId));
    expect(await syncVersion(ledgerId)).toBe(before! + BigInt(1));
  });

  it("allows only one processing attempt per document", async () => {
    const ledgerId = await newLedger();
    const submitted = await submitSourceDocument({
      ledgerId,
      bookId: await testBookId(getTestDb(), ledgerId),
      input: { text: "Receipt", storedFileIds: [], documentDate: null },
    });
    await expect(
      getTestDb().insert(sourceDocumentRevisions).values({
        ledgerId,
        sourceDocumentId: submitted.document.id,
        processingStatus: "processing",
      })
    ).rejects.toThrow();
  });
});
