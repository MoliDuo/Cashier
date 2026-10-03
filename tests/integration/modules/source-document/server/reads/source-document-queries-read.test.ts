import { beforeEach, describe, expect, it } from "vitest";
import { getSourceDocumentInput } from "@/modules/source-document/server/reads/input";
import { createTestSourceDocument, createTestLedger } from "tests/helpers/schema-setup";
import { getTestDb } from "tests/setup";

describe("source-document full query", () => {
  beforeEach(async () => {
    await createTestLedger(getTestDb());
  });

  it("returns full evidence without leaking storage locations", async () => {
    const docId = await createTestSourceDocument(getTestDb(), {
      text: "full payload",
      imageUrls: ["/api/uploads/a.jpg"],
      entryDate: "2026-03-22",
    });

    const existing = await getSourceDocumentInput(docId);

    expect(existing).toMatchObject({
      id: docId,
      text: "full payload",
      files: [expect.objectContaining({ id: expect.any(String), contentType: "image/jpeg" })],
      processingStatus: "completed",
      createdAt: expect.any(String),
    });
    expect(existing).not.toHaveProperty("imageUrls");
    expect(await getSourceDocumentInput(crypto.randomUUID())).toBeNull();
  });
});
