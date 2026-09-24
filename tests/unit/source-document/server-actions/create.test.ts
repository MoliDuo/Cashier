import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireLedgerAccessMock, createAndQueueSourceDocumentMock, resolveRecordBookMock } =
  vi.hoisted(() => ({
    requireLedgerAccessMock: vi.fn(),
    createAndQueueSourceDocumentMock: vi.fn(),
    resolveRecordBookMock: vi.fn(),
  }));

vi.mock("@/modules/ledger/access", () => ({
  requireLedgerAccess: requireLedgerAccessMock,
  withLedgerAccess:
    <TArgs extends unknown[], TResult>(handler: (ledgerId: string, ...args: TArgs) => TResult) =>
    (...args: TArgs) =>
      handler("ledger-1", ...args),
}));

vi.mock("@/modules/source-document/server/resolve-record-book", () => ({
  resolveRecordBook: resolveRecordBookMock,
}));

vi.mock("@/modules/source-document/application/use-cases/create-and-queue-source-document", () => ({
  createAndQueueSourceDocument: createAndQueueSourceDocumentMock,
}));

import { createSourceDocumentAction } from "@/modules/source-document/server-actions/create";
import { sourceDocumentFingerprint } from "@/modules/source-document/source-document-fingerprint";

const CLIENT_SUBMISSION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BOOK_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

describe("createSourceDocumentAction omission semantics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireLedgerAccessMock.mockResolvedValue({
      ledger: { id: "ledger-1", settings: { mainCurrency: "CNY" } },
      userId: USER_ID,
    });
    // The book owns the date zone: a book without one leaves the request's own
    // zone, or the server date, to decide.
    resolveRecordBookMock.mockResolvedValue({ id: BOOK_ID, timeZone: null });
    createAndQueueSourceDocumentMock.mockResolvedValue({
      sourceDocumentId: "doc-1",
      version: 1,
      status: "processing",
    });
  });

  it("omits absent optional fields when forwarding parsed input", async () => {
    await createSourceDocumentAction({ text: "Lunch 12.50" }, CLIENT_SUBMISSION_ID);

    const callInput = createAndQueueSourceDocumentMock.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;

    expect(callInput).toBeDefined();
    expect(callInput.ledgerId).toBe("ledger-1");
    expect(callInput.bookId).toBe(BOOK_ID);
    expect(callInput.input).toEqual({
      kind: "stored",
      text: "Lunch 12.50",
      storedFileIds: [],
    });
    expect(Object.prototype.hasOwnProperty.call(callInput, "images")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(callInput, "originalImages")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(callInput, "documentDate")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(callInput, "timezone")).toBe(false);
  });

  it("dates the record in the book's zone when the request omits one", async () => {
    resolveRecordBookMock.mockResolvedValue({ id: BOOK_ID, timeZone: "Asia/Singapore" });

    await createSourceDocumentAction({ text: "Lunch" }, CLIENT_SUBMISSION_ID);

    expect(createAndQueueSourceDocumentMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ timezone: "Asia/Singapore" })
    );
  });

  it("lets the book's zone win over the request's own", async () => {
    // The book owns the date: the record belongs to it, and the request's zone
    // is only the device the reader happened to use, so it cannot contradict the
    // book the record is being filed into.
    resolveRecordBookMock.mockResolvedValue({ id: BOOK_ID, timeZone: "Asia/Singapore" });

    await createSourceDocumentAction(
      { text: "Lunch", timezone: "Europe/Paris" },
      CLIENT_SUBMISSION_ID
    );

    expect(createAndQueueSourceDocumentMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ timezone: "Asia/Singapore" })
    );
  });

  it("falls back to the request's zone when the book has none of its own", async () => {
    resolveRecordBookMock.mockResolvedValue({ id: BOOK_ID, timeZone: null });

    await createSourceDocumentAction(
      { text: "Lunch", timezone: "Europe/Paris" },
      CLIENT_SUBMISSION_ID
    );

    expect(createAndQueueSourceDocumentMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ timezone: "Europe/Paris" })
    );
  });

  it("forwards an explicitly chosen book to the resolver", async () => {
    const otherBookId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

    await createSourceDocumentAction({ text: "Lunch", bookId: otherBookId }, CLIENT_SUBMISSION_ID);

    expect(resolveRecordBookMock).toHaveBeenCalledWith("ledger-1", otherBookId, expect.anything());
  });

  it("injects scheduleProcessing into use case dependencies", async () => {
    await createSourceDocumentAction({ text: "Lunch" }, CLIENT_SUBMISSION_ID);

    const deps = createAndQueueSourceDocumentMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(deps).toBeDefined();
    expect(typeof deps.scheduleProcessing).toBe("function");
  });

  it("scopes browser idempotency to the authenticated user and payload", async () => {
    await createSourceDocumentAction({ text: "Lunch" }, CLIENT_SUBMISSION_ID);

    expect(createAndQueueSourceDocumentMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        idempotency: {
          principalType: "user",
          principalId: USER_ID,
          key: `source-document:create:ledger-1:new:${CLIENT_SUBMISSION_ID}`,
          contentFingerprint: sourceDocumentFingerprint({ text: "Lunch" }),
        },
      })
    );
  });

  it("rejects an invalid client submission ID", async () => {
    await expect(createSourceDocumentAction({ text: "Lunch" }, "not-a-uuid")).rejects.toThrow(
      "Invalid UUID"
    );
    expect(createAndQueueSourceDocumentMock).not.toHaveBeenCalled();
  });

  it("does not include the legacy operation ID in the business result", async () => {
    const result = await createSourceDocumentAction({ text: "Lunch" }, CLIENT_SUBMISSION_ID);

    expect(createAndQueueSourceDocumentMock).toHaveBeenCalledOnce();
    expect(result).toEqual({ sourceDocumentId: "doc-1", version: 1, status: "processing" });
    expect(result).not.toHaveProperty("reconciliation");
  });
});
