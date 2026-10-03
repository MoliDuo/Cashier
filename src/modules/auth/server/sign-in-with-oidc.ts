import "server-only";
import { completeOidcLogin } from "./oidc";
import { completeInteractiveSignIn } from "./complete-interactive-sign-in";
import { startSession } from "./current-session";

export type OidcSignInOutcome =
  { status: "signed_in"; callbackPath: string } | { status: "denied" | "failed" };

/**
 * The provider vouches for who this is and decides who may sign in; a verified
 * login opens a session for the address it returned.
 */
export async function signInWithOidc(input: {
  query: URLSearchParams;
  flowCookie: string | undefined;
}): Promise<OidcSignInOutcome> {
  const completion = await completeOidcLogin(input);
  if (completion.status !== "authenticated") return { status: completion.status };

  await completeInteractiveSignIn();
  await startSession(completion.email);
  return { status: "signed_in", callbackPath: completion.callbackPath };
}
