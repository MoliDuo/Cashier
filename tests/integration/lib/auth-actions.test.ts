import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { withAuth, requireAuth, requireRecentAuth } from "@/lib/auth-actions";
import { withLedgerAccess } from "@/modules/ledger/access";
import { NotFoundError, UnauthorizedError } from "@/lib/errors";
import { getTestDb } from "tests/setup";
import { ledgers } from "@/persistence";
import { configureTestCoupleLedger, createTestUser } from "tests/helpers/schema-setup";

// Mock next-auth
vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

import { auth } from "@/auth";

const mockAuth = auth as unknown as Mock;

describe("withAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should throw UnauthorizedError when no session", async () => {
    mockAuth.mockResolvedValue(null);

    const action = withAuth(async (userId) => userId);

    await expect(action()).rejects.toThrow(UnauthorizedError);
  });

  it("should throw UnauthorizedError when no user id", async () => {
    mockAuth.mockResolvedValue({ user: {} } as { user: Record<string, never> });

    const action = withAuth(async (userId) => userId);

    await expect(action()).rejects.toThrow(UnauthorizedError);
  });

  it("should pass userId to action when authenticated", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "user-123" },
    } as { user: { id: string } });

    const action = withAuth(async (userId, arg1: string) => {
      return { userId, arg1 };
    });

    const result = await action("test-arg");

    expect(result).toEqual({ userId: "user-123", arg1: "test-arg" });
  });

  it("should handle multiple arguments", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "user-456" },
    } as { user: { id: string } });

    const action = withAuth(async (userId, arg1: string, arg2: number, arg3: boolean) => {
      return { userId, arg1, arg2, arg3 };
    });

    const result = await action("hello", 42, true);

    expect(result).toEqual({ userId: "user-456", arg1: "hello", arg2: 42, arg3: true });
  });
});

describe("withLedgerAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes through when the current user owns the ledger", async () => {
    const db = getTestDb();
    const ledgerId = "00000000-0000-4000-8000-000000000111";
    mockAuth.mockResolvedValue({
      user: { id: "00000000-0000-0000-0000-000000000000" },
    } as { user: { id: string } });

    await db.insert(ledgers).values({
      id: ledgerId,
      userId: "00000000-0000-0000-0000-000000000000",
    });
    await configureTestCoupleLedger(db, ledgerId);

    const action = withLedgerAccess(async (authorizedLedgerId) => authorizedLedgerId);

    await expect(action(ledgerId)).resolves.toBe(ledgerId);
  });

  it("throws NotFoundError when the current user does not own the ledger", async () => {
    const db = getTestDb();
    const ledgerId = "00000000-0000-4000-8000-000000000222";
    const otherUserId = "11111111-1111-4111-8111-111111111111";
    mockAuth.mockResolvedValue({
      user: { id: "00000000-0000-0000-0000-000000000000" },
    } as { user: { id: string } });
    await createTestUser(db, "other@example.com", otherUserId);

    await db.insert(ledgers).values({
      id: ledgerId,
      userId: otherUserId,
    });

    const action = withLedgerAccess(async (authorizedLedgerId) => authorizedLedgerId);

    await expect(action(ledgerId)).rejects.toThrow(NotFoundError);
  });
});

it("does not export withLedgerAccess from lib auth actions anymore", async () => {
  const authActionsModule = await import("@/lib/auth-actions");
  expect("withLedgerAccess" in authActionsModule).toBe(false);
});

describe("requireAuth", () => {
  it("should return userId when authenticated", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "user-789" },
    } as { user: { id: string } });

    const result = await requireAuth();

    expect(result).toBe("user-789");
  });

  it("should throw UnauthorizedError when no session", async () => {
    mockAuth.mockResolvedValue(null);

    await expect(requireAuth()).rejects.toThrow(UnauthorizedError);
  });

  it("should throw UnauthorizedError when no user id", async () => {
    mockAuth.mockResolvedValue({ user: {} } as { user: Record<string, never> });

    await expect(requireAuth()).rejects.toThrow(UnauthorizedError);
  });
});

describe("requireRecentAuth", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-23T12:00:00.000Z"));
  });

  afterEach(() => vi.useRealTimers());

  it("allows authentication within the ten-minute window", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "user-recent", authenticatedAt: "2026-08-23T11:50:00.000Z" },
    });

    await expect(requireRecentAuth()).resolves.toBe("user-recent");
  });

  it("requires reauthentication after the ten-minute window", async () => {
    mockAuth.mockResolvedValue({
      user: { id: "user-stale", authenticatedAt: "2026-08-23T11:49:59.999Z" },
    });

    await expect(requireRecentAuth()).rejects.toMatchObject({
      code: "REAUTHENTICATION_REQUIRED",
    });
  });
});
