import "server-only";
import { UnauthorizedError } from "@/lib/errors";
import { getCurrentSession } from "./current-session";

/** The signed-in account's id, or UnauthorizedError. */
export async function requireAuth(): Promise<string> {
  const session = await getCurrentSession();
  if (session == null) throw new UnauthorizedError("Please log in to perform this action");
  return session.userId;
}

/** Wraps a server action so it receives the signed-in account's id first. */
export function withAuth<TArgs extends unknown[], TReturn>(
  action: (userId: string, ...args: TArgs) => Promise<TReturn>
): (...args: TArgs) => Promise<TReturn> {
  return async (...args: TArgs) => action(await requireAuth(), ...args);
}
