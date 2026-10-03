import "server-only";
import { databasePool } from "@/lib/db";

export type AdvisoryLockResult<T> = { ran: true; value: T } | { ran: false };

/**
 * Runs `work` only if no other session holds the Postgres advisory lock `key`; when another does, returns
 * `{ ran: false }` at once instead of waiting. The lock lives on a dedicated connection for the length of
 * the work, so it is released even if the work throws, and a process that dies releases it with its
 * connection.
 */
export async function withAdvisoryLock<T>(
  key: number,
  work: () => Promise<T>
): Promise<AdvisoryLockResult<T>> {
  const client = await databasePool.connect();
  let healthy = true;
  try {
    const result = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [key]
    );
    if (result.rows[0]?.locked !== true) return { ran: false };
    try {
      return { ran: true, value: await work() };
    } finally {
      try {
        await client.query("SELECT pg_advisory_unlock($1)", [key]);
      } catch {
        // A connection that cannot say it unlocked is dropped, which releases the lock.
        healthy = false;
      }
    }
  } catch (error) {
    healthy = false;
    throw error;
  } finally {
    client.release(healthy ? undefined : true);
  }
}
