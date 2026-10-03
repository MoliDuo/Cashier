import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { ConflictError, ValidationError } from "@/lib/errors";
import { loginEmails, users } from "@/persistence";
import { deleteUserSessions } from "./sessions";

/**
 * Drizzle wraps driver failures in a `DrizzleQueryError` whose `cause` is the
 * original Postgres error, so the SQLSTATE is one level down from what the
 * caller catches.
 */
function isUniqueViolation(error: unknown): boolean {
  let candidate: unknown = error;
  for (let depth = 0; depth < 4 && candidate != null; depth += 1) {
    if (
      candidate instanceof Error &&
      "code" in candidate &&
      (candidate as { code?: unknown }).code === "23505"
    ) {
      return true;
    }
    candidate = (candidate as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Binds an address to the account, so the person the identity provider knows by
 * it can sign in. `email` is already normalized. The unique index on
 * `lower(email)` is what refuses a second row for the same address.
 */
export async function addLoginEmail(input: { userId: string; email: string }): Promise<void> {
  try {
    await db.insert(loginEmails).values({ userId: input.userId, email: input.email });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError("Email is already in use");
    throw error;
  }
}

/**
 * From the command line: binds an address to the one account, for when the
 * identity provider's address for the person changed and nobody can sign in to
 * add it from the settings page.
 */
export async function addLoginEmailToTheAccount(email: string): Promise<void> {
  const [user] = await db.select({ id: users.id }).from(users).limit(1);
  if (user == null) throw new ValidationError("No account exists yet; run account:create first");
  await addLoginEmail({ userId: user.id, email });
}

/**
 * Unbinds one address; `last_email` refuses to leave the account with none.
 * Every session ends with it, because a session does not remember which
 * address opened it.
 */
export async function removeLoginEmail(input: {
  userId: string;
  email: string;
  now: Date;
}): Promise<"removed" | "not_found" | "last_email"> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: loginEmails.id, email: loginEmails.email })
      .from(loginEmails)
      .where(eq(loginEmails.userId, input.userId))
      .for("update");
    if (rows.length <= 1) return "last_email" as const;
    const target = rows.find((row) => row.email.toLowerCase() === input.email);
    if (target == null) return "not_found" as const;
    await tx.delete(loginEmails).where(eq(loginEmails.id, target.id));
    await tx.update(users).set({ updatedAt: input.now }).where(eq(users.id, input.userId));
    await deleteUserSessions(input.userId, tx);
    return "removed" as const;
  });
}
