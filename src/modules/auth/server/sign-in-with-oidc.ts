import "server-only";
import { logger } from "@/lib/logger";
import { logIdentifier } from "@/lib/security/log-identifier";
import { completeOidcLogin } from "./oidc";
import { completeInteractiveSignIn } from "./complete-interactive-sign-in";
import { startSession } from "./current-session";
import { findUserByEmail } from "./users";

export type OidcSignInOutcome =
  { status: "signed_in"; callbackPath: string } | { status: "not_bound" | "denied" | "failed" };

/**
 * The provider vouches for who this is; `login_emails` decides whether that
 * person may use the account. An address nobody has bound opens no session.
 */
export async function signInWithOidc(input: {
  query: URLSearchParams;
  flowCookie: string | undefined;
}): Promise<OidcSignInOutcome> {
  const completion = await completeOidcLogin(input);
  if (completion.status !== "authenticated") return { status: completion.status };

  const user = await findUserByEmail(completion.email);
  if (user == null) {
    logger.warn(
      { subject: logIdentifier("email", completion.email), errorCode: "OIDC_EMAIL_NOT_BOUND" },
      "OIDC sign-in refused: the email is not bound to the account"
    );
    return { status: "not_bound" };
  }
  await completeInteractiveSignIn({ id: user.id, email: user.email });
  await startSession(user.id);
  return { status: "signed_in", callbackPath: completion.callbackPath };
}
