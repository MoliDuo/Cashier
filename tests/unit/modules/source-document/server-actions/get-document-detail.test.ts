import { describe, it, expect, vi, beforeEach } from "vitest";
import { UnauthorizedError } from "@/lib/errors";

vi.mock("@/modules/ledger/access", () => ({
  withLedgerAccess: vi.fn((action) => {
    return async (ledgerId: string, ...args: unknown[]) => {
      if (ledgerId === "unauthorized-ledger") {
        throw new UnauthorizedError("Unauthorized or Ledger not found");
      }
      return action(ledgerId, ...args);
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
  beforeEach(() => vi.clearAllMocks());

  it("throws UnauthorizedError for unauthorized ledger", async () => {
    const { getSourceDocumentDetailAction } =
      await import("@/modules/source-document/server/get-document-detail");
    await expect(
      getSourceDocumentDetailAction("unauthorized-ledger", sourceDocumentId)
    ).rejects.toBeInstanceOf(UnauthorizedError);
  }, 30_000);

  it("returns document for authorized ledger", async () => {
    const { getSourceDocumentDetailAction } =
      await import("@/modules/source-document/server/get-document-detail");
    const result = await getSourceDocumentDetailAction("valid-ledger", sourceDocumentId);
    expect(result).toEqual({ id: sourceDocumentId });
  });

  it("validates the document identity inside the action", async () => {
    const { getSourceDocumentDetailAction } =
      await import("@/modules/source-document/server/get-document-detail");
    await expect(getSourceDocumentDetailAction("valid-ledger", "not-a-uuid")).rejects.toThrow(
      "Validation failed"
    );
  });
});
