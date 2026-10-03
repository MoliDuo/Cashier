/**
 * The document carries its current input — text on the row, files in
 * `source_document_files` — alongside the attempt copies it replaces. Every
 * write that changes which input a document reads keeps the two in step.
 */
import { describe, expect, it, vi } from "vitest";
import { asc, eq } from "drizzle-orm";
import {
  sourceDocumentFiles,
  extractionAttempts,
  sourceDocuments,
  storedFiles,
} from "@/persistence";
import { createTestUserWithLedger, testBookId, createTestRecord } from "tests/helpers/schema-setup";
import { getTestDb } from "tests/setup";
import { submitSourceDocument } from "@/modules/source-document/server/submissions";
import { splitSourceDocumentAtomically } from "@/modules/source-document/server/split";
import { runDailyMaintenance } from "@/server/maintenance/daily";
import { MemoryObjectStore } from "tests/helpers/memory-object-store";

const objectStore = vi.hoisted(() => ({ current: undefined as MemoryObjectStore | undefined }));
vi.mock("@/lib/storage/s3", () => ({ getS3Storage: () => objectStore.current }));

const entry = {
  categoryId: null,
  amount: "12.00",
  currency: "CNY",
  itemName: "Item",
  description: null,
} as const;

async function newLedger() {
  await createTestUserWithLedger(getTestDb(), `document-input-${crypto.randomUUID()}`);
}

async function storeFile() {
  const [file] = await getTestDb()
    .insert(storedFiles)
    .values({
      storageKey: `stored/${crypto.randomUUID()}`,
      contentType: "image/jpeg",
      byteSize: 7,
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

async function syncVersion() {
  const row = await getTestDb().query.ledgerSyncState.findFirst({
    columns: { version: true },
  });
  return row?.version;
}

describe("source document input", () => {
  it("follows each submission: a first upload, an inherited retry, and an edited retry", async () => {
    await newLedger();
    const [first, second, replacement] = await Promise.all([storeFile(), storeFile(), storeFile()]);

    const submitted = await submitSourceDocument({
      bookId: await testBookId(getTestDb()),
      input: { text: "Receipt", storedFileIds: [second, first], documentDate: null },
    });
    const sourceDocumentId = submitted.document.id;
    expect(await documentInput(sourceDocumentId)).toEqual({
      text: "Receipt",
      fileIds: [second, first],
    });

    await submitSourceDocument({
      sourceDocumentId,
      inheritInput: true,
      supersedeProcessing: true,
    });
    expect(await documentInput(sourceDocumentId)).toEqual({
      text: "Receipt",
      fileIds: [second, first],
    });

    await submitSourceDocument({
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
    await newLedger();
    const created = await createTestRecord(getTestDb(), {
      bookId: await testBookId(getTestDb()),
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
      sourceDocumentId: created.sourceDocumentId,
      ledgerEntryIds: [entries[1]!.id],
      entryDate: "2026-08-05",
    });
    expect(await documentInput(split.splitSourceDocumentId)).toEqual({
      text: "Typed by hand",
      fileIds: [],
    });
  });

  it("keeps a file only the document lists out of the unused-file sweep", async () => {
    await newLedger();
    // The second file is on no document, so the sweep takes it.
    const [listed] = await Promise.all([storeFile(), storeFile()]);
    const created = await createTestRecord(getTestDb(), {
      bookId: await testBookId(getTestDb()),
      entries: [entry],
    });
    await getTestDb().insert(sourceDocumentFiles).values({
      sourceDocumentId: created.sourceDocumentId,
      storedFileId: listed,
      position: 0,
    });

    const storage = new MemoryObjectStore();
    objectStore.current = storage;
    const files = await getTestDb()
      .update(storedFiles)
      .set({ createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) })
      .returning({ id: storedFiles.id, key: storedFiles.storageKey });
    for (const file of files) await storage.upload(file.key, Buffer.from("fixture"));

    await expect(runDailyMaintenance()).resolves.toMatchObject({ unused_files: "done" });

    const keyById = new Map(files.map((file) => [file.id, file.key]));
    expect([...storage.files.keys()]).toEqual([keyById.get(listed)]);
    expect(
      (await getTestDb().select({ id: storedFiles.id }).from(storedFiles)).map((file) => file.id)
    ).toEqual([listed]);
  });

  it("leaves the ledger sync version alone when only a processing lease moves", async () => {
    await newLedger();
    const submitted = await submitSourceDocument({
      bookId: await testBookId(getTestDb()),
      input: { text: "Receipt", storedFileIds: [], documentDate: null },
    });
    const attemptId = submitted.attempt.id;
    const db = getTestDb();
    const before = await syncVersion();

    await db
      .update(extractionAttempts)
      .set({
        claimToken: crypto.randomUUID(),
        claimExpiresAt: new Date(Date.now() + 15_000),
        attemptCount: 1,
        nextAttemptAt: new Date(Date.now() + 60_000),
      })
      .where(eq(extractionAttempts.id, attemptId));
    expect(await syncVersion()).toBe(before);

    await db
      .update(extractionAttempts)
      .set({ status: "cancelled", finishedAt: new Date() })
      .where(eq(extractionAttempts.id, attemptId));
    expect(await syncVersion()).toBe(before! + BigInt(1));
  });

  it("allows only one processing attempt per document", async () => {
    await newLedger();
    const submitted = await submitSourceDocument({
      bookId: await testBookId(getTestDb()),
      input: { text: "Receipt", storedFileIds: [], documentDate: null },
    });
    await expect(
      getTestDb().insert(extractionAttempts).values({
        sourceDocumentId: submitted.document.id,
        status: "processing",
      })
    ).rejects.toThrow();
  });
});
