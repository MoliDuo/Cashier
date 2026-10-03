import { db } from "@/lib/db";
import { extractionAttempts } from "@/persistence";
import { eq } from "drizzle-orm";
import { drainBackground } from "./background";

/**
 * Runs the background worker until no processing attempt is left. An attempt that failed
 * transiently comes due again after its retry delay, so this keeps passing until the timeout.
 */
export async function processAllPendingTasks(timeoutMs: number = 10000) {
  const start = Date.now();
  const pending = () =>
    db.query.extractionAttempts.findMany({
      where: eq(extractionAttempts.status, "processing"),
      columns: { id: true },
    });

  while (Date.now() - start < timeoutMs) {
    await drainBackground();
    if ((await pending()).length === 0) return;
    await new Promise((r) => setTimeout(r, 200));
  }

  const pendingSummary = (await pending()).map((attempt) => attempt.id).join(", ");
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for processing tasks: ${pendingSummary || "unknown"}`
  );
}
