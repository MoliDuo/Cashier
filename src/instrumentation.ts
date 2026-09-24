import { validateStartupEnv } from "@/lib/env/startup";
import { logger } from "@/lib/logger";
export async function register() {
  // Only run on server-side runtime (not edge or browser)
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  logger.info("Starting Cashier service...");

  // Log critical configuration status for diagnostics (safe, no secrets exposed)
  try {
    const startupEnv = validateStartupEnv();

    logger.info(
      {
        nodeEnv: process.env.NODE_ENV ?? "not set",
        databaseUrl: startupEnv.DATABASE_URL !== "" ? "configured" : "not configured",
        s3Storage: "configured",
      },
      "Service configuration status"
    );
  } catch (error) {
    logger.error({ error }, "Failed during startup initialization");
    throw error;
  }

  // Reports a pending first-run setup and, when no usable code is stored yet,
  // prints one here so the operator has it before opening the wizard.
  //
  // Everything it needs is imported inside this Node-only branch: `register`
  // is also bundled for the edge runtime, and a static import of the setup
  // module would pull `node:crypto` and the database client into that bundle
  // and fail to compile. Neither an unreachable nor a still-migrating database
  // may stop the process from starting, so the whole check is guarded.
  try {
    const { logPendingSetupAtBoot } = await import("@/modules/setup/server/setup-banner");
    await logPendingSetupAtBoot();
  } catch (error) {
    logger.debug({ error }, "Skipped the first-run setup check at boot");
  }
}
