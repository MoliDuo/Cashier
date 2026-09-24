import { describe, it, expect, vi, beforeEach } from "vitest";
import { authenticateDevUser } from "@/modules/auth/server/authenticate-dev-user";

const findByEmail = vi.hoisted(() => vi.fn());

vi.mock("@/modules/auth/server/users", () => ({ findUserByEmail: findByEmail }));

const devAccount = {
  id: "user-1",
  email: "dev@cashier.local",
  passwordHash: null,
  passwordUpdatedAt: null,
  authVersion: 1,
};

describe("authenticateDevUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DEV_AUTH_BYPASS = "true";
  });

  it("returns the seeded dev account when the bypass is on", async () => {
    findByEmail.mockResolvedValue(devAccount);

    await expect(authenticateDevUser()).resolves.toMatchObject({ id: "user-1" });
  });

  it("returns null when the dev account is missing", async () => {
    findByEmail.mockResolvedValue(null);

    await expect(authenticateDevUser()).resolves.toBeNull();
  });

  it("returns null when the bypass is off", async () => {
    process.env.DEV_AUTH_BYPASS = "false";
    findByEmail.mockResolvedValue(devAccount);

    await expect(authenticateDevUser()).resolves.toBeNull();
    expect(findByEmail).not.toHaveBeenCalled();
  });
});
