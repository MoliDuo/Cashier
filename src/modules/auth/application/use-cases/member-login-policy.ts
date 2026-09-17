import { AUTH_ERROR_CODES, AuthSignInError } from "@/modules/auth/errors";
import { isCoupleMember } from "@/lib/couple-config";
import { logger } from "@/lib/logger";
import { logIdentifier } from "@/lib/security/log-identifier";
import type { UserAccountPort } from "@/application/contracts";

export class MemberLoginDisabledError extends AuthSignInError {
  constructor() {
    super(AUTH_ERROR_CODES.REGISTRATION_DISABLED);
  }
}

export async function isMemberLoginAllowed(
  email: string,
  users: UserAccountPort
): Promise<boolean> {
  const user = await users.findByEmail(email.toLowerCase());
  return user != null && isCoupleMember(user.id);
}

export async function assertMemberLoginAllowed(
  email: string,
  users: UserAccountPort
): Promise<NonNullable<Awaited<ReturnType<UserAccountPort["findByEmail"]>>>> {
  const user = await users.findByEmail(email.toLowerCase());
  if (user != null && isCoupleMember(user.id)) return user;
  logger.warn({ subject: logIdentifier("email", email) }, "Member sign-in denied");
  throw new MemberLoginDisabledError();
}
