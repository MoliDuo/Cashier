import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/auth";
import { POST } from "@/app/api/ledger-queries/route";
import { getTestDb } from "../setup";
import { ledgers, sourceDocuments, users } from "@/persistence";
import { createLedgerData, createSourceDocumentData } from "../helpers/factories";
import {
  activateTestSourceDocumentProjection,
  configureTestCoupleLedger,
} from "../helpers/schema-setup";

vi.mock("@/auth", () => ({ auth: vi.fn() }));

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
    vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue({
      user: { id: userId },
    });
  });

  it("returns private scoped detail and rejects foreign documents and ledgers", async () => {
    const db = getTestDb();
    const ledger = createLedgerData({ userId });
    const other = createLedgerData({ userId: crypto.randomUUID() });
    await db.insert(users).values({ id: other.userId, email: "other-query@example.com" });
    await db.insert(ledgers).values([ledger, other]);
    await configureTestCoupleLedger(db, ledger.id);
    const document = createSourceDocumentData(ledger.id, { status: "completed" });
    await db.insert(sourceDocuments).values({
      ...document,
      attributedUserId: sql`(SELECT user_id FROM ledgers WHERE id = ${document.ledgerId})`,
    });
    await activateTestSourceDocumentProjection(db, document.id);
    const response = await POST(request("detail", [ledger.id, document.id]));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ id: document.id, version: 1 });
    vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue({
      user: { id: other.userId },
    });
    const foreign = await POST(request("detail", [other.id, document.id]));
    expect(foreign.status).toBe(404);
    vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue({
      user: { id: crypto.randomUUID() },
    });
    expect((await POST(request("detail", [ledger.id, document.id]))).status).toBe(404);
  });

  it("requires a session and validates query envelopes", async () => {
    vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue(null);
    expect((await POST(request("detail", [crypto.randomUUID(), crypto.randomUUID()]))).status).toBe(
      401
    );
    expect((await POST(request("delete", [crypto.randomUUID()]))).status).toBe(400);
    expect((await POST(request("detail", ["invalid", "invalid"]))).status).toBe(400);
  });

  it("validates each supported read without leaking internal error data", async () => {
    const ledger = createLedgerData({ userId });
    await getTestDb().insert(ledgers).values(ledger);
    await configureTestCoupleLedger(getTestDb(), ledger.id);
    for (const query of ["detail", "stream", "total", "refresh", "entries", "entry", "summary"]) {
      const response = await POST(request(query, [ledger.id, { unexpected: true }]));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "QUERY_FAILED" });
    }
    expect((await POST(request("stats", [{}]))).status).toBe(400);
  });
});
