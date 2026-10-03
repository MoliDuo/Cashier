import "server-only";
import { DEV_AUTH_EMAIL, isDevAuthBypassEnabled } from "@/modules/auth/dev-auth";

/**
 * Local-dev sign-in: stands in for the identity provider, so it names the
 * address a session opens for. It returns null anywhere else.
 */
export function authenticateDevUser(): string | null {
  return isDevAuthBypassEnabled() ? DEV_AUTH_EMAIL : null;
}
