import "server-only";
import { AppError, UnauthorizedError } from "@/lib/errors";
import { RECENT_AUTH_MAX_AGE_SECONDS } from "@/lib/auth-constants";
import { AUTH_ERROR_CODES } from "@/modules/auth/errors";
import { getCurrentSession } from "./current-session";

/** The signed-in account's id, or UnauthorizedError. */
export async function requireAuth(): Promise<string> {
  const session = await getCurrentSession();
  if (session == null) throw new UnauthorizedError("Please log in to perform this action");
  return session.userId;
}

/** Like requireAuth, for changes that need a sign-in from the last few minutes. */
export async function requireRecentAuth(): Promise<string> {
  const session = await getCurrentSession();
  const age = Date.now() - (session?.authenticatedAt.getTime() ?? Number.NaN);
  if (session == null || !(age >= 0 && age <= RECENT_AUTH_MAX_AGE_SECONDS * 1000)) {
    throw new AppError(
      "Recent authentication required",
      AUTH_ERROR_CODES.REAUTHENTICATION_REQUIRED,
      401
    );
  }
  return session.userId;
}

/** Wraps a server action so it receives the signed-in account's id first. */
export function withAuth<TArgs extends unknown[], TReturn>(
  action: (userId: string, ...args: TArgs) => Promise<TReturn>
): (...args: TArgs) => Promise<TReturn> {
  return async (...args: TArgs) => action(await requireAuth(), ...args);
}
