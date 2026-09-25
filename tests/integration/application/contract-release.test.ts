import { claimRevisionForTest } from "tests/helpers/processing-revision";
import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getTargetSourceDocument } from "@/modules/source-document/server/reads/list";
import { ledgerEntries, processingOutbox, sourceDocuments } from "@/persistence";
import { createTestUserWithLedger, testBookId } from "../../helpers/schema-setup";
import { getTestDb } from "../../setup";
import {
  activateRevision,
  createManualDocument,
} from "@/modules/source-document/server/projections/writes";
import { submitSourceDocument } from "@/modules/source-document/server/submissions";

const projectionEntry = {
  categoryId: null,
  amount: "12.50",
  currency: "CNY",
  itemName: "Lunch",
  description: null,
  convertedAmount: "12.50",
  exchangeRate: "1.000000",
} as const;

describe("local contract release", () => {
  it("writes only target revision, processing, and ledger projections", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const pending = await submitSourceDocument({
      ledgerId,
      input: { text: "Lunch 12.50", storedFileIds: [], documentDate: null },
      bookId: await testBookId(db, ledgerId),
    });
    const created = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, pending.document.id),
    });
    expect(created).not.toBeNull();
    expect(created?.latestSubmissionRevisionId).toBe(pending.revision.id);

    await expect(
      activateRevision({
        lease: await claimRevisionForTest(pending.revision.id),
        ledgerId,
        sourceDocumentId: pending.document.id,
        revisionId: pending.revision.id,
        title: "Target title",
        entries: [projectionEntry],
      })
    ).resolves.toBe(true);

    const completed = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, pending.document.id),
    });
    expect(completed).toMatchObject({
      activeRevisionId: pending.revision.id,
      latestSubmissionRevisionId: pending.revision.id,
      title: "Target title",
    });
    expect(await db.select().from(processingOutbox)).toHaveLength(1);
    expect(await db.select().from(ledgerEntries)).toHaveLength(1);
  });

  it("leaves retained soft-deleted rows unchanged", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const legacyDocumentId = crypto.randomUUID();
    await db.insert(sourceDocuments).values({
      id: legacyDocumentId,
      ledgerId,
      deletedAt: new Date("2026-07-16T00:00:00.000Z"),
      bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
    });
    const beforeDocument = await db.query.sourceDocuments.findFirst({
      where: eq(sourceDocuments.id, legacyDocumentId),
    });

    await createManualDocument({
      ledgerId,
      title: "Target-only entry",
      entries: [projectionEntry],
      bookId: await testBookId(db, ledgerId),
    });

    expect(
      await db.query.sourceDocuments.findFirst({ where: eq(sourceDocuments.id, legacyDocumentId) })
    ).toEqual(beforeDocument);
  });

  it("derives a manual document without submission processing state", async () => {
    const db = getTestDb();
    const { ledgerId } = await createTestUserWithLedger(db);
    const created = await createManualDocument({
      ledgerId,
      inputText: "target revision text",
      entries: [projectionEntry],
      bookId: await testBookId(db, ledgerId),
    });

    await expect(
      getTargetSourceDocument(ledgerId, created.sourceDocumentId)
    ).resolves.toMatchObject({
      id: created.sourceDocumentId,
      processingStatus: null,
    });
  });
});
