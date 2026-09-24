import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LedgerPort } from "@/application/contracts";
import type { AuthenticatedPrincipal } from "@/modules/auth/contracts";

const { resolveHomeMock } = vi.hoisted(() => ({ resolveHomeMock: vi.fn() }));

vi.mock("@/modules/workspace/application/use-cases/resolve-home", () => ({
  resolveHome: resolveHomeMock,
}));

import { completeInteractiveSignIn } from "@/application/use-cases/complete-interactive-sign-in";

const ledgers = {} as LedgerPort;
const dependencies = { ledgers };
const principal: AuthenticatedPrincipal = {
  id: "user-1",
  email: "user@example.com",
  authVersion: 1,
};

describe("completeInteractiveSignIn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveHomeMock.mockResolvedValue({
      id: "ledger-1",
      settings: {},
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("verifies the shared ledger before completing sign-in", async () => {
    const result = await completeInteractiveSignIn(principal, dependencies);

    expect(resolveHomeMock).toHaveBeenCalledWith("user-1", ledgers);
    expect(result).toEqual(principal);
  });

  it("propagates a missing shared ledger instead of handing out a session", async () => {
    resolveHomeMock.mockRejectedValueOnce(new Error("ledger unavailable"));

    await expect(completeInteractiveSignIn(principal, dependencies)).rejects.toThrow(
      "ledger unavailable"
    );
  });
});
