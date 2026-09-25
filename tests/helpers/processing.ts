import { db } from "@/lib/db";
import { sourceDocumentRevisions } from "@/persistence";
import { eq } from "drizzle-orm";

/**
 * Polls for all processing attempts to finish.
 * Tasks run asynchronously in-process.
 * We wait for no revision to be left processing.
 */
export async function processAllPendingTasks(timeoutMs: number = 10000) {
  const start = Date.now();
  const pending = () =>
    db.query.sourceDocumentRevisions.findMany({
      where: eq(sourceDocumentRevisions.processingStatus, "processing"),
      columns: { id: true },
    });

  while (Date.now() - start < timeoutMs) {
    if ((await pending()).length === 0) return;
    await new Promise((r) => setTimeout(r, 200));
  }

  const pendingSummary = (await pending()).map((revision) => revision.id).join(", ");
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for processing tasks: ${pendingSummary || "unknown"}`
  );
}
