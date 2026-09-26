import { describe, it, expect, vi, beforeEach } from "vitest";
import { getTestDb } from "tests/setup";
import { ledgers, loginEmails, users } from "@/persistence";
import { randomUUID } from "node:crypto";
import { ensureTestLedgerBooks } from "tests/helpers/schema-setup";

vi.mock("@/modules/auth/server/current-session", () => ({ getCurrentSession: vi.fn() }));

import { getCurrentSession } from "@/modules/auth/server/current-session";
import { testSession } from "tests/helpers/session";
import { requireLedgerAccess } from "@/modules/ledger/access";
import { NotFoundError, UnauthorizedError } from "@/lib/errors";

const TEST_USER_ID = "00000000-0000-0000-0000-000000000000";

function mockSession(userId = TEST_USER_ID, email = "test@example.com") {
  vi.mocked(getCurrentSession).mockResolvedValue(testSession(userId, { email }));
}

function mockNoSession() {
  vi.mocked(getCurrentSession).mockResolvedValue(null);
}

describe("requireLedgerAccess", () => {
  let ledgerId: string;

  beforeEach(async () => {
    mockSession();
    const db = getTestDb();
    ledgerId = randomUUID();

    // Clean up any existing ledgers for this user first (due to unique constraint)
    await db.delete(ledgers);

    await db.insert(ledgers).values({
      id: ledgerId,
    });
    await ensureTestLedgerBooks(db, ledgerId);
  });

  it("returns userId and ledger when user owns the ledger", async () => {
    const result = await requireLedgerAccess();
    expect(result.userId).toBe(TEST_USER_ID);
    expect(result.ledger.id).toBe(ledgerId);
  });

  it("returns 404 error when ledger belongs to another user", async () => {
    const db = getTestDb();
    const otherUserId = randomUUID();

    await db.insert(users).values({ id: otherUserId }).onConflictDoNothing();
    await db.insert(loginEmails).values({
      userId: otherUserId,
      email: "other@example.com",
      emailVerified: new Date(),
    });

    const otherLedgerId = randomUUID();
    await db.insert(ledgers).values({
      id: otherLedgerId,
    });

    await expect(requireLedgerAccess()).rejects.toThrow(NotFoundError);
  });

  it("returns 401 error when not authenticated", async () => {
    mockNoSession();
    await expect(requireLedgerAccess()).rejects.toThrow(UnauthorizedError);
  });
});
