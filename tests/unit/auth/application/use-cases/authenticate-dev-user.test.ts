import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserAccountPort } from "@/application/contracts";

import { authenticateDevUser } from "@/modules/auth/application/use-cases/authenticate-dev-user";

const OWNER_ID = "00000000-0000-4000-8000-000000000001";
const PARTNER_ID = "00000000-0000-4000-8000-000000000002";

const user = {
  id: OWNER_ID,
  email: "dev@cashier.local",
  name: "Local Developer",
  image: null,
};

const partner = {
  id: PARTNER_ID,
  email: "partner@cashier.local",
  name: "Local Partner",
  image: null,
};

describe("authenticateDevUser", () => {
  const findByEmail = vi.fn();
  const findById = vi.fn();
  const users = { findByEmail, findById } as unknown as UserAccountPort;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DEV_AUTH_BYPASS = "true";
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    process.env.COUPLE_OWNER_USER_ID = OWNER_ID;
    process.env.COUPLE_PARTNER_USER_ID = PARTNER_ID;
    process.env.COUPLE_LEDGER_ID = "00000000-0000-4000-8000-000000000003";
    findByEmail.mockResolvedValue(user);
    findById.mockResolvedValue(partner);
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

  it("signs in as the other couple member when the partner entry is selected", async () => {
    const result = await authenticateDevUser({ locale: "en-US", member: "partner" }, { users });

    expect(findById).toHaveBeenCalledWith(PARTNER_ID);
    expect(result).toEqual({ ...partner, locale: "en-US" });
  });

  /**
   * The partner entry means "the member who is not the dev account", so it
   * follows the couple config instead of assuming the dev account is the owner.
   */
  it("resolves the partner entry against the dev account rather than a fixed role", async () => {
    const otherOwnerId = "00000000-0000-4000-8000-000000000004";
    process.env.COUPLE_OWNER_USER_ID = otherOwnerId;
    process.env.COUPLE_PARTNER_USER_ID = OWNER_ID;
    findById.mockResolvedValue({ ...user, id: otherOwnerId, email: "owner@cashier.local" });

    const result = await authenticateDevUser({ member: "partner" }, { users });

    expect(findById).toHaveBeenCalledWith(otherOwnerId);
    expect(result).toMatchObject({ id: otherOwnerId, email: "owner@cashier.local" });
  });

  it("falls back to the dev account for an unrecognized member", async () => {
    const result = await authenticateDevUser({ locale: "en-US", member: "owner" }, { users });

    expect(findById).not.toHaveBeenCalled();
    expect(result).toEqual({ ...user, locale: "en-US" });
  });

  it("rejects the partner entry when no partner resolves", async () => {
    findById.mockResolvedValue(null);
    await expect(authenticateDevUser({ member: "partner" }, { users })).resolves.toBeNull();
  });

  it("rejects the partner entry when the resolved account is not a couple member", async () => {
    findById.mockResolvedValue({ ...partner, id: "00000000-0000-4000-8000-000000000009" });
    await expect(authenticateDevUser({ member: "partner" }, { users })).resolves.toBeNull();
  });

  it("rejects the partner entry when the dev account is not a couple member", async () => {
    findByEmail.mockResolvedValue({ ...user, id: "00000000-0000-4000-8000-000000000009" });
    await expect(authenticateDevUser({ member: "partner" }, { users })).resolves.toBeNull();
  });
});
