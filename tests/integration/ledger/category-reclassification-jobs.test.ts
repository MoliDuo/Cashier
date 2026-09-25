import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  categoryReclassificationJobDocuments,
  categoryReclassificationJobEntries,
  categoryReclassificationJobs,
  ledgerEntries,
  ledgers,
  sourceDocuments,
} from "@/persistence";
import {
  getCategoryReclassificationJob,
  getLatestCategoryReclassificationJob,
} from "@/server/category-reclassification/jobs";
import { getTestDb } from "../../setup";
import { createLedgerData, createSourceDocumentData } from "../../helpers/factories";
import { ensureTestLedgerBooks } from "../../helpers/schema-setup";

describe("category assignment job reads", () => {
  it("counts progress from the rows and scopes both lookup paths to the ledger", async () => {
    const db = getTestDb();
    const ledger = createLedgerData();
    const other = createLedgerData();
    await db.insert(ledgers).values([ledger, other]);
    await ensureTestLedgerBooks(db, ledger.id);
    const documents = [createSourceDocumentData(ledger.id), createSourceDocumentData(ledger.id)];
    for (const document of documents) {
      await db.insert(sourceDocuments).values({
        ...document,
        bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledger.id} ORDER BY sort_order LIMIT 1)`,
      });
    }
    const entryIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    await db.insert(ledgerEntries).values(
      entryIds.map((id, position) => ({
        id,
        ledgerId: ledger.id,
        sourceDocumentId: documents[position === 2 ? 1 : 0]!.id,
        position,
        amount: "1.00",
        currency: "CNY",
        itemName: `Item ${position}`,
      }))
    );
    const [job] = await db
      .insert(categoryReclassificationJobs)
      .values({ ledgerId: ledger.id, mode: "clear", status: "running" })
      .returning();
    await db.insert(categoryReclassificationJobDocuments).values([
      {
        jobId: job!.id,
        ledgerId: ledger.id,
        sourceDocumentId: documents[0]!.id,
        firstSelectionOrder: 0,
        status: "succeeded",
        evidenceIncomplete: true,
      },
      {
        jobId: job!.id,
        ledgerId: ledger.id,
        sourceDocumentId: documents[1]!.id,
        firstSelectionOrder: 2,
        status: "pending",
        attempts: 1,
        errorCode: "ai_rate_limited",
        nextAttemptAt: new Date(Date.now() + 60_000),
      },
    ]);
    await db.insert(categoryReclassificationJobEntries).values(
      entryIds.map((id, index) => ({
        jobId: job!.id,
        ledgerId: ledger.id,
        ledgerEntryId: id,
        sourceDocumentId: documents[index === 2 ? 1 : 0]!.id,
        selectionOrder: index,
        outcome: index === 0 ? ("applied" as const) : index === 1 ? ("conflict" as const) : null,
      }))
    );

    const read = await getCategoryReclassificationJob({ ledgerId: ledger.id, jobId: job!.id });
    expect(read).toMatchObject({
      id: job!.id,
      mode: { kind: "clear" },
      status: "running",
      entryCount: 3,
      appliedCount: 1,
      conflictCount: 1,
      failedCount: 0,
      documentTotal: 2,
      documentCompleted: 1,
      activeDocumentCount: 0,
      retryingDocumentCount: 1,
      evidenceIncomplete: true,
    });
    expect(read?.nextRetryAt).not.toBeNull();
    expect(await getLatestCategoryReclassificationJob({ ledgerId: ledger.id })).toMatchObject({
      id: job!.id,
    });
    expect(await getCategoryReclassificationJob({ ledgerId: other.id, jobId: job!.id })).toBeNull();
    expect(await getLatestCategoryReclassificationJob({ ledgerId: other.id })).toBeNull();
  });
});
