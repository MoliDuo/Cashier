import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "tests/setup";
import { createTestSourceDocument, createTestUserWithLedger } from "tests/helpers/schema-setup";
import { ledgers, sourceDocumentRevisions } from "@/persistence";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { cancelSourceDocumentProcessingAction } from "@/modules/source-document/server-actions/processing";

describe("cancelSourceDocumentProcessingAction", () => {
  let ledgerId = "";

  beforeEach(async () => {
    const db = getTestDb();
    await db.delete(ledgers);
    ({ ledgerId } = await createTestUserWithLedger(db));
  });

  it("cancels the running parse of the signed-in ledger's document", async () => {
    const db = getTestDb();
    const documentId = await createTestSourceDocument(db, ledgerId, { status: "processing" });

    await expect(cancelSourceDocumentProcessingAction(documentId)).resolves.toEqual({
      processingStatus: "cancelled",
    });
    await expect(
      db.query.sourceDocumentRevisions.findFirst({
        where: eq(sourceDocumentRevisions.sourceDocumentId, documentId),
      })
    ).resolves.toMatchObject({ processingStatus: "cancelled" });
  });

  it("validates the document identity and propagates a missing document", async () => {
    await expect(cancelSourceDocumentProcessingAction("not-a-uuid")).rejects.toThrow(
      ValidationError
    );
    await expect(
      cancelSourceDocumentProcessingAction("00000000-0000-4000-8000-000000000001")
    ).rejects.toThrow(NotFoundError);
  });
});
