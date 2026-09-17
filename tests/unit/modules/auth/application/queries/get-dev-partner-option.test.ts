import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserAccountPort } from "@/application/contracts";
import { getDevPartnerOption } from "@/modules/auth/application/queries/get-dev-partner-option";

const OWNER_ID = "00000000-0000-4000-8000-000000000001";
const PARTNER_ID = "00000000-0000-4000-8000-000000000002";

const devUser = {
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

describe("getDevPartnerOption", () => {
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
    findByEmail.mockResolvedValue(devUser);
    findById.mockResolvedValue(partner);
  });

  it("labels the second entry with the member name", async () => {
    await expect(getDevPartnerOption(users)).resolves.toEqual({ label: "Local Partner" });
  });

  it("falls back to the member email when no name is set", async () => {
    findById.mockResolvedValue({ ...partner, name: null });
    await expect(getDevPartnerOption(users)).resolves.toEqual({
      label: "partner@cashier.local",
    });
  });

  it("stays hidden outside local development", async () => {
    process.env.DEV_AUTH_BYPASS = "false";
    await expect(getDevPartnerOption(users)).resolves.toBeNull();
    expect(findByEmail).not.toHaveBeenCalled();
  });

  it("stays hidden when the dev account is not a couple member", async () => {
    findByEmail.mockResolvedValue({ ...devUser, id: "00000000-0000-4000-8000-000000000009" });
    await expect(getDevPartnerOption(users)).resolves.toBeNull();
    expect(findById).not.toHaveBeenCalled();
  });

  it("stays hidden when the partner account is missing", async () => {
    findById.mockResolvedValue(null);
    await expect(getDevPartnerOption(users)).resolves.toBeNull();
  });
});
