import { describe, expect, it, vi } from "vitest";
import { resolveHome } from "@/modules/workspace/application/use-cases/resolve-home";

describe("resolveHome", () => {
  it("returns the common ledger", async () => {
    const shared = { id: "ledger-1", settings: {}, createdAt: "", updatedAt: "" };
    const getSharedForMember = vi.fn().mockResolvedValue(shared);
    await expect(resolveHome("member-1", { getSharedForMember })).resolves.toBe(shared);
    expect(getSharedForMember).toHaveBeenCalledWith("member-1");
  });

  it("denies access if the shared ledger is unavailable", async () => {
    const getSharedForMember = vi.fn().mockResolvedValue(null);
    await expect(resolveHome("outsider", { getSharedForMember })).rejects.toThrow(
      "Shared ledger is unavailable"
    );
  });
});
