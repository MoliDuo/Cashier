import "server-only";
import { UnauthorizedError } from "@/lib/errors";
import { getCurrentSession } from "./current-session";
import type { SessionUser } from "./sessions";

/** The signed-in session, or UnauthorizedError. */
export async function requireAuth(): Promise<SessionUser> {
  const session = await getCurrentSession();
  if (session == null) throw new UnauthorizedError("Please log in to perform this action");
  return session;
}
