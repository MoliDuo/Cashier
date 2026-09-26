import "server-only";
import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { deriveKey } from "@/lib/security/keys";
import { setupState } from "@/persistence";

/**
 * How long a printed setup code stays usable. The code only protects the window
 * before the first account exists, and the operator reads it from the logs, so
 * a short life is enough: once it lapses the next visit to `/setup` issues a
 * fresh one and prints it again, which is what keeps an unread log line from
 * locking the instance out of its own setup.
 */
export const SETUP_CODE_TTL_MS = 30 * 60 * 1000;

/**
 * How many wrong guesses a single code tolerates. Eight digits is not much of a
 * secret, so the count is what makes guessing impractical. Reaching the limit
 * retires the code: the next visit issues and prints a new one.
 */
export const SETUP_CODE_MAX_ATTEMPTS = 5;

/**
 * The one-time code that protects first-run setup.
 *
 * The wizard creates the account and the ledger, so whoever reaches `/setup`
 * first would otherwise get the whole instance. While setup is pending the
 * server prints this code to its logs and the wizard refuses to run without it,
 * which means the operator deploying the app is the only one who can finish it.
 *
 * The value itself is held in the database, because a production build
 * renders `/setup` and runs its server action in separate realms: a module or
 * `globalThis` value would exist twice and the action would reject the code the
 * page had just logged. The `setup_state` table is what both realms share.
 */
export function generateSetupCode(): string {
  // Eight digits, drawn from a CSPRNG and without leading-zero truncation.
  return String(crypto.randomInt(0, 100_000_000)).padStart(8, "0");
}

/**
 * `mismatch` is a wrong code that still has attempts left; `locked_out` means
 * this guess used the last one and retired the code; `expired` means the stored
 * code is past its lifetime, so a new one has to be issued and printed.
 */
export type SetupCodeVerdict = "accepted" | "mismatch" | "locked_out" | "expired";

/** `created` is true when this call issued the code and therefore owns the plaintext. */
export interface PendingSetupCode {
  code: string;
  created: boolean;
  issuedAt: Date | null;
}

/**
 * Hashes the setup code the way OTPs are hashed: the plaintext only ever exists
 * in the server's logs. A salted HMAC means the stored value is not a usable
 * secret even if the database is read or restored.
 */
function hashSetupCode(code: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .createHmac("sha256", deriveKey("otp"))
    .update(`${salt}:${code}`)
    .digest("hex");
  return `v1:${hash}:${salt}`;
}

function setupCodeMatches(code: string, stored: string): boolean {
  const [version, hash, salt] = stored.split(":");
  if (version !== "v1" || hash == null || salt == null) return false;
  const candidate = crypto
    .createHmac("sha256", deriveKey("otp"))
    .update(`${salt}:${code}`)
    .digest("hex");
  const expected = Buffer.from(hash, "utf8");
  const actual = Buffer.from(candidate, "utf8");
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function isExpired(issuedAt: Date): boolean {
  return Date.now() - issuedAt.getTime() >= SETUP_CODE_TTL_MS;
}

/**
 * The pending setup code, issuing one when none exists or the stored one has
 * expired. `created` tells the caller to print it: only the call that issued
 * it knows the plaintext.
 */
export async function getOrCreateSetupCode(): Promise<PendingSetupCode> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('cashier-first-run-setup'))`);
    const existing = await tx.query.setupState.findFirst({
      columns: { codeHash: true, createdAt: true },
    });
    // An existing hash cannot be turned back into the code the operator needs
    // to read, so the only way to hand out a readable code is to have just
    // written it. A stored code past its lifetime is replaced for that reason:
    // otherwise a code whose log line was missed would refuse every attempt
    // and there would be no way left to finish setup.
    if (existing != null && !isExpired(existing.createdAt)) {
      return { code: "", created: false, issuedAt: existing.createdAt };
    }
    const code = generateSetupCode();
    const issuedAt = new Date();
    if (existing == null) {
      await tx.insert(setupState).values({ codeHash: hashSetupCode(code), createdAt: issuedAt });
    } else {
      // The lockout counter belongs to the retired code, so it starts over.
      await tx
        .update(setupState)
        .set({ codeHash: hashSetupCode(code), createdAt: issuedAt, failedAttempts: 0 });
    }
    return { code, created: true, issuedAt };
  });
}

/**
 * Constant-time comparison against the stored hash, counting failures. Once
 * the attempts are used up the code is retired, so a fresh one is issued and
 * printed on the next visit instead of the guess being retried forever.
 */
export async function verifySetupCode(code: string): Promise<SetupCodeVerdict> {
  return db.transaction(async (tx) => {
    // Two guesses racing must not both read the same counter, or a burst of
    // parallel attempts could spend more than the allowance.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('cashier-first-run-setup'))`);
    const row = await tx.query.setupState.findFirst({
      columns: { codeHash: true, createdAt: true, failedAttempts: true },
    });
    if (row == null) return "expired";
    if (isExpired(row.createdAt)) return "expired";
    if (setupCodeMatches(code, row.codeHash)) return "accepted";

    const attempts = row.failedAttempts + 1;
    if (attempts >= SETUP_CODE_MAX_ATTEMPTS) {
      // Retire it: the next visit issues and prints a fresh code, so the
      // operator is never left with a code that can no longer be accepted.
      await tx.delete(setupState);
      return "locked_out";
    }
    await tx.update(setupState).set({ failedAttempts: attempts });
    return "mismatch";
  });
}
