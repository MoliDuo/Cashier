import { describe, it, expect, vi, beforeEach } from "vitest";
import { getTestDb } from "../../setup";
import { ledgers, loginEmails, users } from "@/persistence";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { ensureTestLedgerBooks } from "../../helpers/schema-setup";

// Override the global auth mock for specific tests
vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

import { auth } from "@/auth";
import { requireLedgerAccess } from "@/modules/ledger/access";
import { NotFoundError, UnauthorizedError } from "@/lib/errors";

const TEST_USER_ID = "00000000-0000-0000-0000-000000000000";

function mockSession(userId = TEST_USER_ID, email = "test@example.com") {
  vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue({
    user: { id: userId, email },
    expires: new Date(Date.now() + 3600 * 1000).toISOString(),
  });
}

function mockNoSession() {
  vi.mocked(auth as unknown as () => Promise<unknown>).mockResolvedValue(null);
}

describe("requireLedgerAccess", () => {
  let ledgerId: string;

  beforeEach(async () => {
    mockSession();
    const db = getTestDb();
    ledgerId = uuidv4();

    // Clean up any existing ledgers for this user first (due to unique constraint)
    await db.delete(ledgers).where(eq(ledgers.userId, TEST_USER_ID));

    await db.insert(ledgers).values({
      id: ledgerId,
      userId: TEST_USER_ID,
    });
    await ensureTestLedgerBooks(db, ledgerId);
  });

  it("returns userId and ledger when user owns the ledger", async () => {
    const result = await requireLedgerAccess(ledgerId);
    expect(result.userId).toBe(TEST_USER_ID);
    expect(result.ledger.id).toBe(ledgerId);
  });

  it("returns 404 error when ledger belongs to another user", async () => {
    const db = getTestDb();
    const otherUserId = uuidv4();

    await db.insert(users).values({ id: otherUserId }).onConflictDoNothing();
    await db.insert(loginEmails).values({
      userId: otherUserId,
      email: "other@example.com",
      emailVerified: new Date(),
    });

    const otherLedgerId = uuidv4();
    await db.insert(ledgers).values({
      id: otherLedgerId,
      userId: otherUserId,
    });

    await expect(requireLedgerAccess(otherLedgerId)).rejects.toThrow(NotFoundError);
  });

  it("returns 404 error for invalid UUID", async () => {
    await expect(requireLedgerAccess("not-a-valid-uuid")).rejects.toThrow(NotFoundError);
  });

  it("returns 404 error for soft-deleted ledger", async () => {
    const db = getTestDb();
    const deletedLedgerId = uuidv4();
    const anotherUserId = uuidv4();

    // Use a different user to avoid unique constraint violation
    // (TEST_USER_ID already has a ledger from beforeEach)
    await db.insert(users).values({ id: anotherUserId }).onConflictDoNothing();
    await db.insert(loginEmails).values({
      userId: anotherUserId,
      email: `deleted-ledger-${uuidv4()}@example.com`,
      emailVerified: new Date(),
    });

    await db.insert(ledgers).values({
      id: deletedLedgerId,
      userId: anotherUserId,
      deletedAt: new Date(),
    });

    // Mock session as the another user to test access to their deleted ledger
    mockSession(anotherUserId, `deleted-ledger-${uuidv4()}@example.com`);

    await expect(requireLedgerAccess(deletedLedgerId)).rejects.toThrow(NotFoundError);
  });

  it("returns 401 error when not authenticated", async () => {
    mockNoSession();
    await expect(requireLedgerAccess(ledgerId)).rejects.toThrow(UnauthorizedError);
  });
});
