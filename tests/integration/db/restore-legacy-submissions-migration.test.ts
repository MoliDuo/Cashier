import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  getSourceDocumentInput,
  getTargetSourceDocument,
} from "@/application/adapters/postgres/source-document-reads";
import {
  revisionFiles,
  sourceDocumentRevisions,
  sourceDocuments,
  storedFiles,
} from "@/persistence";
import { createTestUserWithLedger } from "../../helpers/schema-setup";
import { getTestPool, getTestDb } from "../../setup";

const migrationStatements = readFileSync(
  "src/persistence/postgres-migrations/0046_restore_legacy_submissions.sql",
  "utf8"
)
  .split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter((statement) => statement !== "");

/** Apply the repair migration the way the runner does: one statement at a time. */
async function applyRepairMigration(): Promise<void> {
  const client = await getTestPool().connect();
  try {
    for (const statement of migrationStatements) await client.query(statement);
  } finally {
    client.release();
  }
}

/**
 * Recreate the shape 0038 produced for a revision migrated from the retired
 * SQLite database: a submission's input with no live processing evidence, which
 * 0038 therefore labelled `manual_edit` and left detached.
 */
async function insertLegacyDocument(
  db: ReturnType<typeof getTestDb>,
  ledgerId: string,
  overrides: { text?: string | null; withFile?: boolean; deleted?: boolean } = {}
): Promise<{ documentId: string; revisionId: string }> {
  return db.transaction(async (tx) => {
    const [document] = await tx
      .insert(sourceDocuments)
      .values({
        ledgerId,
        documentDate: "2026-07-17",
        attributedUserId: sql`(SELECT user_id FROM ledgers WHERE id = ${ledgerId})`,
        deletedAt: overrides.deleted === true ? new Date() : null,
      })
      .returning();
    const [revision] = await tx
      .insert(sourceDocumentRevisions)
      .values({
        ledgerId,
        sourceDocumentId: document!.id,
        revisionNumber: 1,
        origin: "manual_edit",
        inputText: overrides.text ?? null,
        processingStatus: null,
      })
      .returning();
    await tx
      .update(sourceDocuments)
      .set({ activeRevisionId: revision!.id })
      .where(eq(sourceDocuments.id, document!.id));
    if (overrides.withFile === true) {
      const [file] = await tx
        .insert(storedFiles)
        .values({
          ledgerId,
          storageProvider: "local",
          storageKey: `tests/${document!.id}/0`,
          contentType: "image/jpeg",
          byteSize: 1,
          finalizedAt: new Date(),
        })
        .returning();
      await tx.insert(revisionFiles).values({
        ledgerId,
        revisionId: revision!.id,
        storedFileId: file!.id,
        position: 0,
      });
    }
    return { documentId: document!.id, revisionId: revision!.id };
  });
}

describe("legacy submission credential repair", () => {
  it("restores submission input for repaired documents and leaves manual entries alone", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);

    const legacyWithImage = await insertLegacyDocument(db, ledgerId, { withFile: true });
    const legacyWithText = await insertLegacyDocument(db, ledgerId, {
      text: "七月十七日午餐 25 元",
    });
    const manualEntry = await insertLegacyDocument(db, ledgerId, {});
    const deletedLegacy = await insertLegacyDocument(db, ledgerId, {
      withFile: true,
      deleted: true,
    });

    // The bug: the submission input is invisible before the repair runs.
    const broken = await getSourceDocumentInput(ledgerId, legacyWithImage.documentId);
    expect(broken?.files).toEqual([]);

    await applyRepairMigration();

    const repairedWithImage = await getSourceDocumentInput(ledgerId, legacyWithImage.documentId);
    expect(repairedWithImage).toMatchObject({
      id: legacyWithImage.documentId,
      processingStatus: "completed",
      documentDate: "2026-07-17",
    });
    expect(repairedWithImage?.files).toHaveLength(1);
    expect(repairedWithImage?.files[0]?.id).toBeDefined();

    const repairedWithText = await getSourceDocumentInput(ledgerId, legacyWithText.documentId);
    expect(repairedWithText?.text).toBe("七月十七日午餐 25 元");
    expect(repairedWithText?.files).toEqual([]);

    // Retry / edit-retry needs the recovered input to be advertised.
    const detail = await getTargetSourceDocument(ledgerId, legacyWithImage.documentId);
    expect(detail?.supportedActions).toContain("edit_retry");
    expect(detail?.supportedActions).toContain("retry");
    expect(detail?.files).toHaveLength(1);

    // A document with neither an image nor text is a genuine manual entry and
    // must keep its manual origin and stay detached.
    const untouched = await getSourceDocumentInput(ledgerId, manualEntry.documentId);
    expect(untouched?.files).toEqual([]);
    const untouchedDocument = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, manualEntry.documentId),
    });
    expect(untouchedDocument?.latestSubmissionRevisionId).toBeNull();
    const untouchedRevision = await db.query.sourceDocumentRevisions.findFirst({
      where: eq(sourceDocumentRevisions.id, manualEntry.revisionId),
    });
    expect(untouchedRevision?.origin).toBe("manual_edit");

    // Deleted documents are repaired too: a restore must not resurrect them
    // without their original credentials.
    const repairedDeleted = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, deletedLegacy.documentId),
    });
    expect(repairedDeleted?.latestSubmissionRevisionId).toBe(deletedLegacy.revisionId);
  });

  it("is idempotent and does not disturb active results or document versions", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const legacy = await insertLegacyDocument(db, ledgerId, { withFile: true });

    const before = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, legacy.documentId),
    });
    const beforeFiles = await db.select().from(revisionFiles);
    const beforeStored = await db.select().from(storedFiles);

    await applyRepairMigration();
    const afterFirst = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, legacy.documentId),
    });
    await applyRepairMigration();
    const afterSecond = await db
      .select()
      .from(sourceDocumentRevisions)
      .where(eq(sourceDocumentRevisions.id, legacy.revisionId));

    expect(afterFirst?.version).toBe(before?.version);
    expect(afterFirst?.activeRevisionId).toBe(before?.activeRevisionId);
    expect(afterSecond[0]).toMatchObject({
      origin: "submission",
      processingStatus: "completed",
      inputDocumentDate: "2026-07-17",
    });
    expect(await db.select().from(revisionFiles)).toEqual(beforeFiles);
    expect(await db.select().from(storedFiles)).toEqual(beforeStored);
  });

  it("keeps split children detached instead of adopting the parent's content", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);

    // The parent's revision 1 is a recognized submission: 0038 left it alone.
    const parent = await insertLegacyDocument(db, ledgerId, { withFile: true });
    await db
      .update(sourceDocumentRevisions)
      .set({ origin: "submission", processingStatus: "completed" })
      .where(eq(sourceDocumentRevisions.id, parent.revisionId));
    await db
      .update(sourceDocuments)
      .set({ latestSubmissionRevisionId: parent.revisionId })
      .where(eq(sourceDocuments.id, parent.documentId));
    const parentFiles = await db
      .select()
      .from(revisionFiles)
      .where(eq(revisionFiles.revisionId, parent.revisionId));

    // Splitting copies the parent's text and files into a new document whose
    // revision 1 (a `manual_edit`) is not a submission of its own.
    const child = await insertLegacyDocument(db, ledgerId, { withFile: true });
    await db
      .update(revisionFiles)
      .set({ storedFileId: parentFiles[0]!.storedFileId })
      .where(eq(revisionFiles.revisionId, child.revisionId));

    await applyRepairMigration();

    const childRevision = await db.query.sourceDocumentRevisions.findFirst({
      where: eq(sourceDocumentRevisions.id, child.revisionId),
    });
    expect(childRevision?.origin).toBe("manual_edit");
    expect(childRevision?.processingStatus).toBeNull();
    const childDocument = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, child.documentId),
    });
    expect(childDocument?.latestSubmissionRevisionId).toBeNull();
    expect(await getSourceDocumentInput(ledgerId, child.documentId)).toMatchObject({ files: [] });

    // The parent still resolves its own input.
    const parentInput = await getSourceDocumentInput(ledgerId, parent.documentId);
    expect(parentInput?.files).toHaveLength(1);
  });
});
