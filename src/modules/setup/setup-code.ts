import "server-only";
import crypto from "node:crypto";
import { logger } from "@/lib/logger";
import type { SetupPort } from "@/application/contracts";

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

/**
 * The pending setup code, printing it the first time it exists. Reading an
 * already-stored code does not print or invalidate it: the operator may need to
 * retype it, and it stops mattering as soon as the account exists.
 */
export async function getSetupCodeForDisplay(setup: SetupPort): Promise<string> {
  const { code, created } = await setup.getOrCreateCode();
  if (created) {
    logger.warn(
      { setupCode: code },
      "First-run setup is pending. Enter this setup code in the wizard to create the account."
    );
  }
  return code;
}
