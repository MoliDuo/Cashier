import "server-only";
import { logger } from "@/lib/logger";
import { withAdvisoryLock } from "@/lib/db/advisory-lock";
import { DAILY_MAINTENANCE_BOOT_DELAY_MS, DAILY_MAINTENANCE_HOUR_UTC } from "@/config/tuning";
import { runDailyMaintenance, type DailyMaintenanceOptions } from "@/server/maintenance/daily";

/** Held while a sweep runs, so that of several processes sharing a database only one sweeps. */
const DAILY_MAINTENANCE_LOCK_KEY = 1_947_001;

export interface DailyScheduler {
  start(): void;
  /** Stops scheduling and waits for a sweep that is already running. */
  stop(): Promise<void>;
}

export interface DailySchedulerOptions {
  bootDelayMs?: number;
  hourUtc?: number;
  sweep?: (options?: DailyMaintenanceOptions) => ReturnType<typeof runDailyMaintenance>;
}

/** The next moment after `now` at which the clock in UTC reads `hourUtc`:00. */
export function nextDailyRun(now: Date, hourUtc: number): Date {
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc)
  );
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

/**
 * Runs the daily maintenance sweep from inside the process: once shortly after boot, to make up for
 * a day the process was down, and then every day at `hourUtc`. Every sweep is idempotent, so running
 * one more than needed costs nothing, and the advisory lock keeps two processes from sweeping at once.
 */
export function createDailyScheduler(options: DailySchedulerOptions = {}): DailyScheduler {
  const bootDelayMs = options.bootDelayMs ?? DAILY_MAINTENANCE_BOOT_DELAY_MS;
  const hourUtc = options.hourUtc ?? DAILY_MAINTENANCE_HOUR_UTC;
  const sweep = options.sweep ?? runDailyMaintenance;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let running: Promise<void> = Promise.resolve();

  async function runSweep(): Promise<void> {
    try {
      const result = await withAdvisoryLock(DAILY_MAINTENANCE_LOCK_KEY, () => sweep());
      if (!result.ran) {
        logger.info("Daily maintenance is running in another process; skipping");
        return;
      }
      const failed = Object.entries(result.value)
        .filter(([, outcome]) => outcome === "failed")
        .map(([step]) => step);
      logger.info({ failedSteps: failed }, "Daily maintenance finished");
    } catch (error) {
      logger.error({ error }, "Daily maintenance failed");
    }
  }

  function arm(delayMs: number, then: () => void) {
    timer = setTimeout(then, delayMs);
    timer.unref();
  }

  function scheduleNextDay() {
    if (stopped) return;
    arm(nextDailyRun(new Date(), hourUtc).getTime() - Date.now(), () => {
      running = runSweep().finally(scheduleNextDay);
    });
  }

  return {
    start() {
      if (timer != null || stopped) return;
      arm(bootDelayMs, () => {
        running = runSweep().finally(scheduleNextDay);
      });
    },
    async stop() {
      stopped = true;
      clearTimeout(timer);
      await running;
    },
  };
}
