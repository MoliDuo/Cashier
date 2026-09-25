import { beforeEach, describe, expect, it } from "vitest";
import { getSourceDocumentInput } from "@/modules/source-document/server/reads/input";
import { createTestSourceDocument, createTestUserWithLedger } from "tests/helpers/schema-setup";
import { getTestDb } from "tests/setup";

describe("source-document full query", () => {
  let ledgerId = "";

  beforeEach(async () => {
    const setup = await createTestUserWithLedger(getTestDb());
    ledgerId = setup.ledgerId;
  });

  it("returns full evidence without leaking storage locations", async () => {
    const docId = await createTestSourceDocument(getTestDb(), ledgerId, {
      text: "full payload",
      imageUrls: ["/api/uploads/a.jpg"],
      entryDate: "2026-03-22",
    });

    const existing = await getSourceDocumentInput(ledgerId, docId);

    expect(existing).toMatchObject({
      id: docId,
      text: "full payload",
      files: [expect.objectContaining({ id: expect.any(String), contentType: "image/jpeg" })],
      processingStatus: "completed",
      createdAt: expect.any(String),
    });
    expect(existing).not.toHaveProperty("imageUrls");
    expect(await getSourceDocumentInput(ledgerId, crypto.randomUUID())).toBeNull();
  });
});
