import { sql } from "drizzle-orm";
import { describe, it, expect, beforeEach } from "vitest";
import { getTestDb } from "tests/setup";
import { ledgers, ledgerEntries } from "@/persistence";
import { sourceDocuments } from "@/persistence/schema/source-document";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import { deleteLedgerEntryAction } from "@/modules/ledger/server-actions/entries";
import {
  activateTestSourceDocumentProjection,
  ensureTestLedgerBooks,
} from "tests/helpers/schema-setup";

async function seedDoc(db: ReturnType<typeof getTestDb>, ledgerId: string, entryDate?: string) {
  const [doc] = await db
    .insert(sourceDocuments)
    .values({
      id: randomUUID(),
      ledgerId,
      documentDate: entryDate ?? null,
      bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
    })
    .returning();
  expect(doc).toBeDefined();
  if (doc === undefined) {
    throw new Error("Expected source document insert to return a row");
  }
  await activateTestSourceDocumentProjection(db, doc.id);
  return doc;
}

describe("deleteLedgerEntryAction", () => {
  let ledgerId: string;

  beforeEach(async () => {
    const db = getTestDb();
    ledgerId = randomUUID();
    await db.insert(ledgers).values({
      id: ledgerId,
    });
    await ensureTestLedgerBooks(db, ledgerId);
  });

  it("soft-deletes an entry", async () => {
    const db = getTestDb();
    const doc = await seedDoc(db, ledgerId);
    const [entry] = await db
      .insert(ledgerEntries)
      .values({
        id: randomUUID(),
        ledgerId,
        sourceDocumentId: doc.id,
        itemName: "Test",
        amount: "10.00",
        currency: "CNY",
      })
      .returning();
    expect(entry).toBeDefined();
    if (entry === undefined) {
      throw new Error("Expected ledger entry insert to return a row");
    }
    await activateTestSourceDocumentProjection(db, doc.id);

    await deleteLedgerEntryAction(doc.id, entry.id);

    const deleted = await db.query.ledgerEntries.findFirst({
      where: eq(ledgerEntries.id, entry.id),
    });
    expect(deleted).toBeUndefined();
  });
});
