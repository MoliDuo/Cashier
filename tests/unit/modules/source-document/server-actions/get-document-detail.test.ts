import { describe, it, expect, vi, beforeEach } from "vitest";
import { UnauthorizedError } from "@/lib/errors";

const authorized = vi.hoisted(() => ({ value: true }));

vi.mock("@/modules/ledger/access", () => ({
  withLedgerAccess: vi.fn((action) => {
    return async (...args: unknown[]) => {
      if (authorized.value === false) {
        throw new UnauthorizedError("Unauthorized or Ledger not found");
      }
      return action("ledger-1", ...args);
    };
  }),
}));

vi.mock("@/application/server-composition-root", () => ({
  serverComposition: {
    sourceDocumentReads: {
      get: vi.fn().mockResolvedValue({ id: "11111111-1111-4111-8111-111111111111" }),
    },
  },
}));
const sourceDocumentId = "11111111-1111-4111-8111-111111111111";

describe("getSourceDocumentDetailAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authorized.value = true;
  });

  it("throws UnauthorizedError when the caller has no ledger access", async () => {
    authorized.value = false;
    const { getSourceDocumentDetailAction } =
      await import("@/modules/source-document/server/get-document-detail");
    await expect(getSourceDocumentDetailAction(sourceDocumentId)).rejects.toBeInstanceOf(
      UnauthorizedError
    );
  }, 30_000);

  it("returns document for authorized ledger", async () => {
    const { getSourceDocumentDetailAction } =
      await import("@/modules/source-document/server/get-document-detail");
    const result = await getSourceDocumentDetailAction(sourceDocumentId);
    expect(result).toEqual({ id: sourceDocumentId });
  });

  it("validates the document identity inside the action", async () => {
    const { getSourceDocumentDetailAction } =
      await import("@/modules/source-document/server/get-document-detail");
    await expect(getSourceDocumentDetailAction("not-a-uuid")).rejects.toThrow("Validation failed");
  });
});
