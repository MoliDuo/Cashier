import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getTestDb } from "tests/setup";
import { users } from "@/persistence/schema/auth";
import { AUTH_ERROR_CODES } from "@/modules/auth/errors";
import {
  assertRegistrationAllowed as assertRegistrationAllowedWithPort,
  isRegistrationAllowed as isRegistrationAllowedWithPort,
  RegistrationDisabledError,
} from "@/modules/auth/application/use-cases/registration-policy";
import { serverComposition } from "@/application/server-composition-root";
import { configureTestCoupleLedger, TEST_USER_ID } from "tests/helpers/schema-setup";

const isRegistrationAllowed = (email: string) =>
  isRegistrationAllowedWithPort(email, serverComposition.userAccounts);
const assertRegistrationAllowed = (email: string) =>
  assertRegistrationAllowedWithPort(email, serverComposition.userAccounts);

describe("registration policy use-case", () => {
  const originalDisableRegistration = process.env.DISABLE_REGISTRATION;

  beforeEach(() => {
    delete process.env.DISABLE_REGISTRATION;
  });

  afterEach(() => {
    if (originalDisableRegistration == null) {
      delete process.env.DISABLE_REGISTRATION;
    } else {
      process.env.DISABLE_REGISTRATION = originalDisableRegistration;
    }
  });

  it("blocks registration even when the general feature flag is not enabled", async () => {
    await expect(isRegistrationAllowed("new-user@example.com")).resolves.toBe(false);
  });

  it("blocks new users when registration is disabled", async () => {
    process.env.DISABLE_REGISTRATION = "true";

    await expect(isRegistrationAllowed("new-user@example.com")).resolves.toBe(false);
    await expect(assertRegistrationAllowed("new-user@example.com")).rejects.toBeInstanceOf(
      RegistrationDisabledError
    );
    await expect(assertRegistrationAllowed("new-user@example.com")).rejects.toMatchObject({
      code: AUTH_ERROR_CODES.REGISTRATION_DISABLED,
    });
  });

  it("allows existing users when registration is disabled", async () => {
    process.env.DISABLE_REGISTRATION = "true";
    const db = getTestDb();

    await db
      .update(users)
      .set({ email: "existing@example.com", registrationCompletedAt: new Date() })
      .where(eq(users.id, TEST_USER_ID));
    await configureTestCoupleLedger(db, crypto.randomUUID());

    await expect(isRegistrationAllowed("EXISTING@EXAMPLE.COM")).resolves.toBe(true);
    await expect(assertRegistrationAllowed("EXISTING@EXAMPLE.COM")).resolves.toBeUndefined();
  });
});
