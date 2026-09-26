import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCurrentSession } from "@/modules/auth/server/current-session";
import { testSession } from "../helpers/session";
import { POST } from "@/app/api/ledger-queries/route";
import { getTestDb } from "../setup";
import { ledgers, sourceDocuments } from "@/persistence";
import { createLedgerData, createSourceDocumentData } from "../helpers/factories";
import {
  activateTestSourceDocumentProjection,
  ensureTestLedgerBooks,
} from "../helpers/schema-setup";

vi.mock("@/modules/auth/server/current-session", () => ({ getCurrentSession: vi.fn() }));

function request(query: string, args: unknown[]) {
  return new Request("http://localhost/api/ledger-queries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, args }),
  });
}

describe("session ledger query transport", () => {
  const userId = "00000000-0000-0000-0000-000000000000";
  beforeEach(() => {
    vi.mocked(getCurrentSession).mockResolvedValue(testSession(userId));
  });

  it("returns private scoped detail and refuses a caller without the live ledger", async () => {
    const db = getTestDb();
    const ledger = createLedgerData();
    await db.insert(ledgers).values(ledger);
    await ensureTestLedgerBooks(db, ledger.id);
    const document = createSourceDocumentData(ledger.id, { status: "completed" });
    await db.insert(sourceDocuments).values({
      ...document,
      bookId: sql`(SELECT id FROM books WHERE ledger_id = ${document.ledgerId} ORDER BY sort_order LIMIT 1)`,
    });
    await activateTestSourceDocumentProjection(db, document.id);

    const response = await POST(request("detail", [document.id]));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ id: document.id, version: 1 });

    // An unknown document inside the live ledger is an empty read, not an
    // error: the detail loader reports "no such record" with a null body.
    const unknownDocument = await POST(request("detail", [crypto.randomUUID()]));
    expect(unknownDocument.status).toBe(200);
    expect(await unknownDocument.json()).toBeNull();

    vi.mocked(getCurrentSession).mockResolvedValue(testSession(crypto.randomUUID()));
    expect((await POST(request("detail", [document.id]))).status).toBe(404);
  });

  it("requires a session and validates query envelopes", async () => {
    vi.mocked(getCurrentSession).mockResolvedValue(null);
    expect((await POST(request("detail", [crypto.randomUUID()]))).status).toBe(401);
    expect((await POST(request("delete", [crypto.randomUUID()]))).status).toBe(400);
    expect((await POST(request("detail", ["invalid", "invalid"]))).status).toBe(400);
  });

  it("validates each supported read without leaking internal error data", async () => {
    const ledger = createLedgerData();
    await getTestDb().insert(ledgers).values(ledger);
    await ensureTestLedgerBooks(getTestDb(), ledger.id);
    for (const query of [
      "detail",
      "stream",
      "total",
      "refresh",
      "entries",
      "entry",
      "ledger",
      "books",
      "books-including-archived",
      "book",
      "categories",
      "summary",
      "settings",
    ]) {
      const response = await POST(request(query, [{ unexpected: true }]));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "QUERY_FAILED" });
    }
    expect((await POST(request("stats", [{}]))).status).toBe(400);
  });

  it("serves the settings reads over the same scoped transport", async () => {
    const db = getTestDb();
    const ledger = createLedgerData();
    await db.insert(ledgers).values(ledger);
    await ensureTestLedgerBooks(db, ledger.id);

    const ledgerRead = await POST(request("ledger", []));
    expect(ledgerRead.status).toBe(200);
    expect(ledgerRead.headers.get("cache-control")).toBe("private, no-store");
    expect(await ledgerRead.json()).toMatchObject({ id: ledger.id });

    const categoriesRead = await POST(request("categories", []));
    expect(categoriesRead.status).toBe(200);
    expect(categoriesRead.headers.get("cache-control")).toBe("private, no-store");
    expect(await categoriesRead.json()).toEqual([]);

    const settingsRead = await POST(request("settings", []));
    expect(settingsRead.status).toBe(200);
    expect(settingsRead.headers.get("cache-control")).toBe("private, no-store");
    expect(await settingsRead.json()).toEqual({ uncategorizedCount: 0, credentials: [] });
  });

  it("serves the books reads over the same scoped transport", async () => {
    const db = getTestDb();
    const ledger = createLedgerData();
    await db.insert(ledgers).values(ledger);
    const books = await ensureTestLedgerBooks(db, ledger.id, ["共同支出", "旧账"]);
    const liveBookId = books.get("共同支出")!;
    const retiredBookId = books.get("旧账")!;
    await db.execute(sql`UPDATE books SET archived_at = now() WHERE id = ${retiredBookId}`);

    const live = await POST(request("books", []));
    expect(live.status).toBe(200);
    expect(live.headers.get("cache-control")).toBe("private, no-store");
    expect((await live.json()).map((book: { id: string }) => book.id)).toEqual([liveBookId]);

    // The retired book is named on its own and listed beside the live one, but
    // never in the switcher's list.
    const withArchived = await POST(request("books-including-archived", []));
    expect(withArchived.status).toBe(200);
    expect(withArchived.headers.get("cache-control")).toBe("private, no-store");
    expect((await withArchived.json()).map((book: { id: string }) => book.id).sort()).toEqual(
      [liveBookId, retiredBookId].sort()
    );

    const retired = await POST(request("book", [retiredBookId]));
    expect(retired.status).toBe(200);
    expect(await retired.json()).toMatchObject({ id: retiredBookId, name: "旧账" });
    expect(await (await POST(request("book", [crypto.randomUUID()]))).json()).toBeNull();
    expect((await POST(request("book", ["not-a-uuid"]))).status).toBe(400);

    // A read that takes no arguments refuses one.
    expect((await POST(request("books", [ledger.id]))).status).toBe(400);
  });
});
