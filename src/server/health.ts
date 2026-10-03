import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

/** Whether the database answers a trivial query; never throws. */
export async function isDatabaseReachable(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}
