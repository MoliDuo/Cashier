import { beforeEach, describe, expect, it, vi } from "vitest";
import { asc, eq } from "drizzle-orm";
import { getTestDb } from "tests/setup";
import { createTestSourceDocument, createTestUserWithLedger } from "tests/helpers/schema-setup";
import { createOpenAIMock } from "tests/helpers/mocks/openai";
import { processAllPendingTasks } from "tests/helpers/processing";
import { ledgerEntries, ledgers, sourceDocumentRevisions, sourceDocuments } from "@/persistence";
import { getCurrentSession } from "@/modules/auth/server/current-session";
import { getOpenAIClient } from "@/lib/ai/openai-client";
import { NotFoundError, UnauthorizedError, ValidationError } from "@/lib/errors";
import {
  batchDeleteSourceDocumentsAction,
  batchRetrySourceDocumentsAction,
} from "@/modules/source-document/server-actions/batch";

vi.mock("@/lib/ai/openai-client", () => ({
  getOpenAIClient: vi.fn(),
  resetOpenAIClient: vi.fn(),
}));

const MISSING_ID = "00000000-0000-4000-8000-000000000001";

describe("source document batch actions", () => {
  let ledgerId = "";

  beforeEach(async () => {
    vi.mocked(getOpenAIClient).mockReturnValue(
      createOpenAIMock() as unknown as ReturnType<typeof getOpenAIClient>
    );
    const db = getTestDb();
    await db.delete(ledgers);
    ({ ledgerId } = await createTestUserWithLedger(db));
  });

  it("deletes each document on its own and reports a missing one under a stable code", async () => {
    const db = getTestDb();
    const kept = await createTestSourceDocument(db, ledgerId);
    const deleted = await createTestSourceDocument(db, ledgerId);

    const result = await batchDeleteSourceDocumentsAction([MISSING_ID, deleted]);

    expect(result).toEqual({
      succeeded: [{ id: deleted, sourceDocumentId: deleted }],
      failed: [{ id: MISSING_ID, code: "NOT_FOUND" }],
    });
    const remaining = await db.select({ id: sourceDocuments.id }).from(sourceDocuments);
    expect(remaining.map((row) => row.id)).toEqual([kept]);
  });

  it("refuses an empty batch and runs a duplicated target once", async () => {
    const document = await createTestSourceDocument(getTestDb(), ledgerId);

    await expect(batchDeleteSourceDocumentsAction([])).rejects.toThrow(ValidationError);
    await expect(batchDeleteSourceDocumentsAction([document, document])).resolves.toEqual({
      succeeded: [{ id: document, sourceDocumentId: document }],
      failed: [],
    });
  });

  it("keeps retrying later documents after one fails, inheriting each one's evidence", async () => {
    const db = getTestDb();
    const document = await createTestSourceDocument(db, ledgerId, { text: "午餐 25元" });

    const result = await batchRetrySourceDocumentsAction([MISSING_ID, document]);

    expect(result).toEqual({
      succeeded: [{ id: document, sourceDocumentId: document }],
      failed: [{ id: MISSING_ID, code: "NOT_FOUND" }],
    });
    await processAllPendingTasks();
    const revisions = await db
      .select()
      .from(sourceDocumentRevisions)
      .where(eq(sourceDocumentRevisions.sourceDocumentId, document))
      .orderBy(asc(sourceDocumentRevisions.createdAt));
    expect(revisions).toHaveLength(2);
    expect(revisions[1]).toMatchObject({ processingStatus: "completed" });
    await expect(
      db.query.sourceDocuments.findFirst({ where: eq(sourceDocuments.id, document) })
    ).resolves.toMatchObject({
      inputText: "午餐 25元",
      latestSubmissionRevisionId: revisions[1]!.id,
    });
    await expect(
      db.select().from(ledgerEntries).where(eq(ledgerEntries.sourceDocumentId, document))
    ).resolves.toHaveLength(1);
  });

  it("passes the access failures through unchanged", async () => {
    vi.mocked(getCurrentSession).mockResolvedValueOnce(null);
    await expect(batchDeleteSourceDocumentsAction([MISSING_ID])).rejects.toBeInstanceOf(
      UnauthorizedError
    );

    // A second ledger makes the single live one ambiguous: not found, never
    // re-labelled as a sign-in problem.
    await getTestDb().insert(ledgers).values({ id: crypto.randomUUID() });
    await expect(batchRetrySourceDocumentsAction([MISSING_ID])).rejects.toBeInstanceOf(
      NotFoundError
    );
  });
});
