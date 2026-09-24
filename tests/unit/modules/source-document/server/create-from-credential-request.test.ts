import { beforeEach, describe, expect, it, vi } from "vitest";

const { createAndQueueSourceDocumentMock, getBookMock } = vi.hoisted(() => ({
  createAndQueueSourceDocumentMock: vi.fn(),
  getBookMock: vi.fn(),
}));

vi.mock("@/modules/source-document/server/create-and-queue", () => ({
  createAndQueueSourceDocument: createAndQueueSourceDocumentMock,
}));
vi.mock("@/modules/ledger/server/books", () => ({ getBook: getBookMock }));
vi.mock("@/server/processing/recovery", () => ({
  scheduleProcessingRecoveryAfter: vi.fn(),
}));
vi.mock("@/server/maintenance/schedule", () => ({
  scheduleRequestMaintenance: vi.fn(),
}));

import { createSourceDocumentFromCredentialRequest } from "@/modules/source-document/server/create-from-credential-request";
import type { PreparedApiV1SourceDocumentInput } from "@/modules/source-document/api-v1-policy";

const credential = { id: "cred-1", ledgerId: "ledger-1", bookId: "book-1" };

describe("createSourceDocumentFromCredentialRequest", () => {
  const preparedImage = {
    bytes: Buffer.from("AQ==", "base64"),
    mimeType: "image/jpeg",
    contentHash: "a".repeat(64),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    getBookMock.mockResolvedValue({ id: "book-1", timeZone: null });
    createAndQueueSourceDocumentMock.mockResolvedValue({
      sourceDocumentId: "doc-1",
      status: "processing",
    });
  });

  it("forwards the authenticated principal ledger and omits undefined payload fields", async () => {
    const payload: PreparedApiV1SourceDocumentInput = { images: [preparedImage] };

    await createSourceDocumentFromCredentialRequest({ credential, payload });

    const callInput = createAndQueueSourceDocumentMock.mock.calls[0]?.[0];
    expect(callInput).toEqual({
      ledgerId: "ledger-1",
      bookId: "book-1",
      input: { kind: "inline", images: [preparedImage] },
    });
    expect(callInput).not.toHaveProperty("ledger");
  });

  it("dates the record in the key's book zone when the book has one", async () => {
    getBookMock.mockResolvedValueOnce({ id: "book-1", timeZone: "Asia/Shanghai" });

    await createSourceDocumentFromCredentialRequest({
      credential,
      payload: { images: [preparedImage] },
    });

    expect(getBookMock).toHaveBeenCalledWith("ledger-1", "book-1");
    expect(createAndQueueSourceDocumentMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ timezone: "Asia/Shanghai" })
    );
  });

  it("leaves the date to the server when the key's book has no zone", async () => {
    await createSourceDocumentFromCredentialRequest({
      credential,
      payload: { images: [preparedImage] },
    });

    expect(createAndQueueSourceDocumentMock.mock.calls[0]?.[0]).not.toHaveProperty("timezone");
  });

  it("scopes idempotency to the credential and the request content", async () => {
    await createSourceDocumentFromCredentialRequest({
      credential,
      idempotencyKey: "key-1",
      requestId: "request-1",
      payload: { images: [preparedImage] },
    });

    expect(createAndQueueSourceDocumentMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        idempotency: {
          principalType: "credential",
          principalId: "cred-1",
          key: "key-1",
          contentFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
        },
        requestId: "request-1",
      })
    );
  });
});
