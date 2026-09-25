import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { ledgerEntries, sourceDocuments } from "@/persistence";

export async function hasActiveLedgerEntries(ledgerId: string): Promise<boolean> {
  const row = await db
    .select({ exists: sql<number>`1` })
    .from(ledgerEntries)
    .innerJoin(
      sourceDocuments,
      and(
        eq(sourceDocuments.ledgerId, ledgerId),
        eq(sourceDocuments.id, ledgerEntries.sourceDocumentId)
      )
    )
    .where(eq(ledgerEntries.ledgerId, ledgerId))
    .limit(1)
    .then((rows) => rows[0]);
  return row != null;
}
