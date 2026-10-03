import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTestDb } from "tests/setup";
import { createTestUserWithLedger } from "tests/helpers/schema-setup";
import { testSession } from "tests/helpers/session";
import { getCurrentSession } from "@/modules/auth/server/current-session";
import { findUserByEmail } from "@/modules/auth/server/users";
import {
  addLoginEmailAction,
  removeLoginEmailAction,
} from "@/modules/auth/server-actions/login-emails";

describe("login email actions", () => {
  let userId: string;

  beforeEach(async () => {
    ({ userId } = await createTestUserWithLedger(getTestDb(), "me@example.com"));
    vi.mocked(getCurrentSession).mockResolvedValue(testSession(userId));
  });

  it("adds an address, normalised, and answers with the account's whole list", async () => {
    await expect(addLoginEmailAction("  Partner@Example.com ")).resolves.toEqual({
      ok: true,
      emails: ["me@example.com", "partner@example.com"],
    });
    expect(await findUserByEmail("partner@example.com")).toMatchObject({ id: userId });
  });

  it("names why an address is refused", async () => {
    await expect(addLoginEmailAction("not an email")).resolves.toEqual({
      ok: false,
      code: "invalid_email",
    });
    await expect(addLoginEmailAction("ME@example.com")).resolves.toEqual({
      ok: false,
      code: "email_in_use",
    });
  });

  it("removes an address and lists what is left", async () => {
    await addLoginEmailAction("partner@example.com");

    await expect(removeLoginEmailAction("partner@example.com")).resolves.toEqual({
      ok: true,
      emails: ["me@example.com"],
    });
    expect(await findUserByEmail("partner@example.com")).toBeNull();
  });

  it("keeps the last address, and calls an unknown one unknown", async () => {
    await expect(removeLoginEmailAction("me@example.com")).resolves.toEqual({
      ok: false,
      code: "last_email",
    });
    await addLoginEmailAction("partner@example.com");
    await expect(removeLoginEmailAction("nobody@example.com")).resolves.toEqual({
      ok: false,
      code: "unknown",
    });
    expect(await findUserByEmail("me@example.com")).toMatchObject({ id: userId });
  });

  it("does nothing without a session", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue(null);

    await expect(addLoginEmailAction("partner@example.com")).resolves.toEqual({
      ok: false,
      code: "unknown",
    });
    await expect(removeLoginEmailAction("me@example.com")).resolves.toEqual({
      ok: false,
      code: "unknown",
    });
    expect(await findUserByEmail("partner@example.com")).toBeNull();
  });
});
