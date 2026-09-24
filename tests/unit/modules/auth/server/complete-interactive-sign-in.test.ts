import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedPrincipal } from "@/modules/auth/contracts";

const { getLiveLedgerMock } = vi.hoisted(() => ({ getLiveLedgerMock: vi.fn() }));

vi.mock("@/modules/ledger/server/live-ledger", () => ({
  getLiveLedger: getLiveLedgerMock,
}));

import { completeInteractiveSignIn } from "@/modules/auth/server/complete-interactive-sign-in";

const principal: AuthenticatedPrincipal = {
  id: "user-1",
  email: "user@example.com",
  authVersion: 1,
};

describe("completeInteractiveSignIn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getLiveLedgerMock.mockResolvedValue({
      id: "ledger-1",
      settings: {},
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("verifies the shared ledger before completing sign-in", async () => {
    const result = await completeInteractiveSignIn(principal);

    expect(getLiveLedgerMock).toHaveBeenCalledWith("user-1");
    expect(result).toEqual(principal);
  });

  it("refuses a session while the shared ledger is missing", async () => {
    getLiveLedgerMock.mockResolvedValueOnce(null);

    await expect(completeInteractiveSignIn(principal)).rejects.toThrow(
      "Shared ledger is unavailable"
    );
  });
});
