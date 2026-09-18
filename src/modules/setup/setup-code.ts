import "server-only";
import crypto from "node:crypto";
import { logger } from "@/lib/logger";
import type { SetupPort } from "@/application/contracts";

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
 * The value itself is held by the setup port, because a production build
 * renders `/setup` and runs its server action in separate realms: a module or
 * `globalThis` value would exist twice and the action would reject the code the
 * page had just logged. The `setup_state` table is what both realms share.
 */
export function generateSetupCode(): string {
  // Eight digits, drawn from a CSPRNG and without leading-zero truncation.
  return String(crypto.randomInt(0, 100_000_000)).padStart(8, "0");
}

/** `created` is true when this call issued the code and therefore owns the plaintext. */
export interface PendingSetupCode {
  code: string;
  created: boolean;
  issuedAt: Date | null;
}

/**
 * The pending setup code, printing it whenever it is issued. An unexpired code
 * that was already printed is returned without a banner: the operator may need
 * to retype it, and it stops mattering as soon as the account exists.
 */
export async function getSetupCodeForDisplay(setup: SetupPort): Promise<PendingSetupCode> {
  const pending = await setup.getOrCreateCode();
  if (pending.created) {
    logger.warn(
      { setupCode: pending.code },
      "First-run setup is pending. Enter this setup code in the wizard to create the account."
    );
  }
  return pending;
}

/**
 * Reports a pending setup at boot, so the operator who reads the startup logs
 * learns two things without visiting the app: that setup has not run, and when
 * the current code was issued — which is what tells them whether the code they
 * were given is still inside its lifetime.
 *
 * The caller passes the port, because resolving it here would make the setup
 * adapter import the composition root that wires the adapter.
 *
 * It never throws: a database that is unreachable or not yet migrated must not
 * stop the process from starting, and the wizard repeats the banner anyway.
 */
export async function logPendingSetupAtBoot(setup: SetupPort): Promise<void> {
  try {
    if (!(await setup.isPending())) return;
    const pending = await setup.getOrCreateCode();
    if (pending.created) {
      logger.warn(
        { setupCode: pending.code },
        "First-run setup is pending. Enter this setup code in the wizard to create the account."
      );
      return;
    }
    logger.warn(
      { issuedAt: pending.issuedAt?.toISOString() ?? null },
      "First-run setup is pending. The setup code was issued at the timestamp above and expires 30 minutes after it; visit /setup to have a new one printed."
    );
  } catch (error) {
    logger.debug({ error }, "Skipped the first-run setup check at boot");
  }
}
