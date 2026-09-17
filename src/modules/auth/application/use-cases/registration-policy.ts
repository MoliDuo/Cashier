import { AUTH_ERROR_CODES, AuthSignInError } from "@/modules/auth/errors";
import { isCoupleMember } from "@/lib/couple-config";
import { logger } from "@/lib/logger";
import { logIdentifier } from "@/lib/security/log-identifier";
import type { UserAccountPort } from "@/application/contracts";

export class RegistrationDisabledError extends AuthSignInError {
  constructor() {
    super(AUTH_ERROR_CODES.REGISTRATION_DISABLED);
  }
}

export async function isRegistrationAllowed(
  email: string,
  users: UserAccountPort
): Promise<boolean> {
  // This branch is restricted to the two accounts configured for the shared ledger.

  const normalizedEmail = email.toLowerCase();
  const user = await users.findByEmail(normalizedEmail);
  return user != null && user.registrationCompletedAt != null && isCoupleMember(user.id);
}

export async function assertRegistrationAllowed(
  email: string,
  users: UserAccountPort
): Promise<void> {
  if (await isRegistrationAllowed(email, users)) {
    return;
  }

  logger.warn(
    { subject: logIdentifier("email", email) },
    "Registration disabled for new user sign-in"
  );
  throw new RegistrationDisabledError();
}
