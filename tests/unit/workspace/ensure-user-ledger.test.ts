import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LedgerPort } from "@/application/contracts";
import { ensureUserLedger } from "@/modules/workspace/application/use-cases/ensure-user-ledger";
vi.mock("@/lib/couple-config", () => ({
  getCoupleConfig: () => ({ ownerId: "user-1", partnerId: "user-2", ledgerId: "shared-ledger" }),
  isCoupleMember: (id: string) => id === "user-1" || id === "user-2",
}));

function harness() {
  const listForUser = vi.fn();
  const createDefault = vi.fn();
  return {
    listForUser,
    createDefault,
    port: { listForUser, createDefault } as unknown as LedgerPort,
  };
}

function ledger(id: string) {
  return {
    id,
    userId: "user-1",
    settings: { mainCurrency: "USD" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("ensureUserLedger", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves the shared ledger for both members without creating one", async () => {
    const test = harness();
    test.listForUser.mockResolvedValue([ledger("shared-ledger")]);
    for (const userId of ["user-1", "user-2"]) {
      await expect(ensureUserLedger({ userId }, test.port)).resolves.toEqual({
        ledger: ledger("shared-ledger"),
        created: false,
      });
    }
    expect(test.createDefault).not.toHaveBeenCalled();
  });

  it("rejects a third account and a missing shared ledger", async () => {
    const test = harness();
    test.listForUser.mockResolvedValue([]);
    await expect(ensureUserLedger({ userId: "user-3" }, test.port)).rejects.toThrow();
    await expect(ensureUserLedger({ userId: "user-1" }, test.port)).rejects.toThrow(
      "Shared ledger is unavailable"
    );
    expect(test.createDefault).not.toHaveBeenCalled();
  });
});
