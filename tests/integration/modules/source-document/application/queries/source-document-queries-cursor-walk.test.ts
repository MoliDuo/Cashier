import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getTestDb } from "tests/setup";
import {
  activateTestSourceDocumentProjection,
  createTestUserWithLedger,
} from "tests/helpers/schema-setup";
import { sourceDocuments } from "@/persistence";
import { listStreamPage as listStreamPageUseCase } from "@/modules/source-document/application/queries/list-stream-page";
import { serverComposition } from "@/application/server-composition-root";

const queryPorts = {
  documents: serverComposition.sourceDocumentReads,
  ledgerReads: serverComposition.ledgerReads,
  changes: serverComposition.ledgerChanges,
};
const listStreamPage = (ledgerId: string, input: Parameters<typeof listStreamPageUseCase>[1]) =>
  listStreamPageUseCase(ledgerId, input, queryPorts);

describe("source-document-queries", () => {
  let ledgerId = "";

  beforeEach(async () => {
    const db = getTestDb();
    const setup = await createTestUserWithLedger(db);
    ledgerId = setup.ledgerId;
  });

  it("walks all cursors from start to final null", async () => {
    const db = getTestDb();

    // Create 25 documents with varying entry dates
    for (let i = 0; i < 25; i++) {
      const day = 28 - i;
      const inserted = await db
        .insert(sourceDocuments)
        .values({
          ledgerId,
          documentDate: `2026-03-${String(day).padStart(2, "0")}`,
          createdAt: new Date(`2026-03-${String(day).padStart(2, "0")}T12:00:00Z`),
          bookId: sql`(SELECT id FROM books WHERE ledger_id = ${ledgerId} ORDER BY sort_order LIMIT 1)`,
        })
        .returning();
      await activateTestSourceDocumentProjection(db, inserted[0]!.id);
    }

    let pageCount = 0;
    let cursor: string | undefined;
    const seenInWalk = new Set<string>();

    for (let i = 0; i < 50; i++) {
      const page = await listStreamPage(ledgerId, {
        cursor,
        limit: 7,
      });
      pageCount++;
      for (const item of page.items) {
        expect(seenInWalk.has(item.id)).toBe(false);
        seenInWalk.add(item.id);
      }
      cursor = page.nextCursor ?? undefined;
      if (cursor == null) break;
    }

    expect(seenInWalk.size).toBe(25);
    expect(pageCount).toBe(4); // 7+7+7+4 = 25
    expect(cursor).toBeUndefined();
  });
});
