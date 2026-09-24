import "server-only";
import { logger } from "@/lib/logger";
import { isSetupPending } from "./initial-account";
import { getOrCreateSetupCode, type PendingSetupCode } from "./setup-code";

/**
 * The pending setup code, printing it whenever it is issued. An unexpired code
 * that was already printed is returned without a banner: the operator may need
 * to retype it, and it stops mattering as soon as the account exists.
 */
export async function getSetupCodeForDisplay(): Promise<PendingSetupCode> {
  const pending = await getOrCreateSetupCode();
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
 * It never throws: a database that is unreachable or not yet migrated must not
 * stop the process from starting, and the wizard repeats the banner anyway.
 */
export async function logPendingSetupAtBoot(): Promise<void> {
  try {
    if (!(await isSetupPending())) return;
    const pending = await getOrCreateSetupCode();
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
