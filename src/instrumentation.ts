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

    // A half-set pair turns telemetry off without a word, so say so once at boot.
    if ((startupEnv.INSIGHT_URL == null) !== (startupEnv.INSIGHT_KEY == null)) {
      logger.warn("Telemetry is off: INSIGHT_URL and INSIGHT_KEY must be set together");
    }

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
}
