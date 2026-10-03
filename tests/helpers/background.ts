import { createBackgroundWorker } from "@/server/background/worker";

/**
 * Runs the background work that is due, as the worker would, and returns once none is left. Tests
 * call it where production would have woken the worker, so the state they assert is settled.
 */
export async function drainBackground(): Promise<number> {
  return createBackgroundWorker().drain();
}
