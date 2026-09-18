import { describe, it, expect, vi, beforeEach } from "vitest";
import { authenticateDevUser } from "@/modules/auth/application/use-cases/authenticate-dev-user";
import type { UserAccountPort } from "@/application/contracts";

const findByEmail = vi.fn();
const users = { findByEmail, findById: vi.fn() } as unknown as UserAccountPort;

const devAccount = {
  id: "user-1",
  email: "dev@cashier.local",
  name: "Dev",
  image: null,
  passwordHash: null,
  passwordUpdatedAt: null,
  authVersion: 1,
  interfaceLanguage: "auto" as const,
};

describe("authenticateDevUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DEV_AUTH_BYPASS = "true";
  });

  it("returns the seeded dev account when the bypass is on", async () => {
    findByEmail.mockResolvedValue(devAccount);

    await expect(authenticateDevUser({}, { users })).resolves.toMatchObject({
      id: "user-1",
      locale: "zh-CN",
    });
  });

  it("carries the requested locale", async () => {
    findByEmail.mockResolvedValue(devAccount);

    await expect(authenticateDevUser({ locale: "en" }, { users })).resolves.toMatchObject({
      locale: "en",
    });
  });

  it("returns null when the dev account is missing", async () => {
    findByEmail.mockResolvedValue(null);

    await expect(authenticateDevUser({}, { users })).resolves.toBeNull();
  });

  it("returns null when the bypass is off", async () => {
    process.env.DEV_AUTH_BYPASS = "false";
    findByEmail.mockResolvedValue(devAccount);

    await expect(authenticateDevUser({}, { users })).resolves.toBeNull();
    expect(findByEmail).not.toHaveBeenCalled();
  });
});
