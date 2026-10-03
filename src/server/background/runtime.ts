import "server-only";
import { logger } from "@/lib/logger";
import { createBackgroundWorker, type BackgroundWorker } from "@/server/background/worker";

const RUNTIME_KEY = Symbol.for("cashier.background.runtime");
const STOP_GRACE_MS = 20_000;

interface Runtime {
  worker: BackgroundWorker;
}

function holder(): Record<symbol, Runtime | undefined> {
  return globalThis as unknown as Record<symbol, Runtime | undefined>;
}

/**
 * Starts the worker for this process, once. Called from instrumentation, so a development server that
 * reloads its modules does not start a second one.
 *
 * On SIGTERM the worker stops claiming work and is given time to finish what it holds, then the
 * process exits. `next start` only leaves the signal to us when NEXT_MANUAL_SIG_HANDLE is set, which the
 * Dockerfile does; elsewhere Next exits at once and the leases cover for it.
 */
export function startBackgroundRuntime(): void {
  if (holder()[RUNTIME_KEY] != null) return;
  const worker = createBackgroundWorker();
  holder()[RUNTIME_KEY] = { worker };
  worker.start();
  logger.info("Background worker started");

  if (process.env.NEXT_MANUAL_SIG_HANDLE !== "true") return;
  const shutDown = (signal: NodeJS.Signals) => {
    logger.info({ signal }, "Stopping background worker");
    void worker
      .stop({ graceMs: STOP_GRACE_MS })
      .catch((error: unknown) => logger.error({ error }, "Background worker failed to stop"))
      .finally(() => process.exit(0));
  };
  process.once("SIGTERM", shutDown);
  process.once("SIGINT", shutDown);
}
