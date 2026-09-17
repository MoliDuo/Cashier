import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserAccountPort } from "@/application/contracts";

import { authenticateDevUser } from "@/modules/auth/application/use-cases/authenticate-dev-user";

const user = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "dev@cashier.local",
  name: "Local Developer",
  image: null,
};

describe("authenticateDevUser", () => {
  const findByEmail = vi.fn();
  const users = { findByEmail } as unknown as UserAccountPort;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DEV_AUTH_BYPASS = "true";
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    process.env.COUPLE_OWNER_USER_ID = user.id;
    process.env.COUPLE_PARTNER_USER_ID = "00000000-0000-4000-8000-000000000002";
    process.env.COUPLE_LEDGER_ID = "00000000-0000-4000-8000-000000000003";
    findByEmail.mockResolvedValue(user);
  });

  it("rejects when the flag is not enabled", async () => {
    process.env.DEV_AUTH_BYPASS = "false";
    await expect(authenticateDevUser({ locale: "zh-CN" }, { users })).resolves.toBeNull();
  });

  it("rejects in production even when the flag is set", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    await expect(authenticateDevUser({ locale: "zh-CN" }, { users })).resolves.toBeNull();
  });

  it("returns the principal through the target user port", async () => {
    const result = await authenticateDevUser({ locale: "en-US" }, { users });
    expect(findByEmail).toHaveBeenCalledWith("dev@cashier.local");
    expect(result).toEqual({ ...user, locale: "en-US" });
  });
});
