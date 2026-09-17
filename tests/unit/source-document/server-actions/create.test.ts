import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireLedgerAccessMock, createAndQueueSourceDocumentMock, getCoupleMembersMock } =
  vi.hoisted(() => ({
    requireLedgerAccessMock: vi.fn(),
    createAndQueueSourceDocumentMock: vi.fn(),
    getCoupleMembersMock: vi.fn(),
  }));

vi.mock("@/modules/auth/application/queries/get-couple-members", () => ({
  getCoupleMembers: getCoupleMembersMock,
}));

vi.mock("@/modules/ledger/access", () => ({
  requireLedgerAccess: requireLedgerAccessMock,
  withLedgerAccess: <TArgs extends unknown[], TResult>(
    handler: (ledgerId: string, ...args: TArgs) => TResult
  ) => handler,
}));

vi.mock("@/lib/couple-config", () => ({
  isCoupleMember: (id: string) => id === "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
}));

vi.mock("@/modules/source-document/application/use-cases/create-and-queue-source-document", () => ({
  createAndQueueSourceDocument: createAndQueueSourceDocumentMock,
}));

import { createSourceDocumentAction } from "@/modules/source-document/server-actions/create";
import { sourceDocumentFingerprint } from "@/modules/source-document/source-document-fingerprint";

const CLIENT_SUBMISSION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("createSourceDocumentAction omission semantics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireLedgerAccessMock.mockResolvedValue({
      ledger: { id: "ledger-1", settings: { mainCurrency: "CNY" } },
      userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    // The signed-in member has no zone of their own, so the request's own
    // zone (when it sends one) is what dates the record.
    getCoupleMembersMock.mockResolvedValue([
      { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", nickname: "A", gender: "male", timeZone: null },
      {
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        nickname: "B",
        gender: "female",
        timeZone: "Asia/Tokyo",
      },
    ]);
    createAndQueueSourceDocumentMock.mockResolvedValue({
      sourceDocumentId: "doc-1",
      version: 1,
      status: "processing",
    });
  });

  it("omits absent optional fields when forwarding parsed input", async () => {
    await createSourceDocumentAction("ledger-1", { text: "Lunch 12.50" }, CLIENT_SUBMISSION_ID);

    const callInput = createAndQueueSourceDocumentMock.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;

    expect(callInput).toBeDefined();
    expect(callInput.ledgerId).toBe("ledger-1");
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

  it("uses the signed-in member's own timezone when the request omits one", async () => {
    getCoupleMembersMock.mockResolvedValue([
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        nickname: "A",
        gender: "male",
        timeZone: "Asia/Singapore",
      },
      {
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        nickname: "B",
        gender: "female",
        timeZone: null,
      },
    ]);

    await createSourceDocumentAction("ledger-1", { text: "Lunch" }, CLIENT_SUBMISSION_ID);

    expect(createAndQueueSourceDocumentMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ timezone: "Asia/Singapore" })
    );
  });

  it("injects scheduleProcessing into use case dependencies", async () => {
    await createSourceDocumentAction("ledger-1", { text: "Lunch" }, CLIENT_SUBMISSION_ID);

    const deps = createAndQueueSourceDocumentMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(deps).toBeDefined();
    expect(typeof deps.scheduleProcessing).toBe("function");
  });

  it("scopes browser idempotency to the authenticated user and payload", async () => {
    await createSourceDocumentAction("ledger-1", { text: "Lunch" }, CLIENT_SUBMISSION_ID);

    expect(createAndQueueSourceDocumentMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        idempotency: {
          principalType: "user",
          principalId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          key: `source-document:create:ledger-1:new:${CLIENT_SUBMISSION_ID}`,
          contentFingerprint: sourceDocumentFingerprint({ text: "Lunch" }),
        },
      })
    );
  });

  it("rejects an invalid client submission ID", async () => {
    await expect(
      createSourceDocumentAction("ledger-1", { text: "Lunch" }, "not-a-uuid")
    ).rejects.toThrow("Invalid UUID");
    expect(createAndQueueSourceDocumentMock).not.toHaveBeenCalled();
  });

  it("does not include the legacy operation ID in the business result", async () => {
    const result = await createSourceDocumentAction(
      "ledger-1",
      { text: "Lunch" },
      CLIENT_SUBMISSION_ID
    );

    expect(createAndQueueSourceDocumentMock).toHaveBeenCalledOnce();
    expect(result).toEqual({ sourceDocumentId: "doc-1", version: 1, status: "processing" });
    expect(result).not.toHaveProperty("reconciliation");
  });
});
