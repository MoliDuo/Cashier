import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withAuth, requireAuth, requireRecentAuth } from "@/modules/auth/server/session-guards";
import { withLedgerAccess } from "@/modules/ledger/access";
import { NotFoundError, UnauthorizedError } from "@/lib/errors";
import { getTestDb } from "tests/setup";
import { createTestUserWithLedger } from "tests/helpers/schema-setup";
import { testSession } from "tests/helpers/session";

vi.mock("@/modules/auth/server/current-session", () => ({ getCurrentSession: vi.fn() }));

import { getCurrentSession } from "@/modules/auth/server/current-session";

const mockSession = vi.mocked(getCurrentSession);

describe("withAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws UnauthorizedError without a session", async () => {
    mockSession.mockResolvedValue(null);

    const action = withAuth(async (userId) => userId);

    await expect(action()).rejects.toThrow(UnauthorizedError);
  });

  it("passes the user id and the action's arguments", async () => {
    mockSession.mockResolvedValue(testSession("user-456"));

    const action = withAuth(async (userId, arg1: string, arg2: number, arg3: boolean) => {
      return { userId, arg1, arg2, arg3 };
    });

    await expect(action("hello", 42, true)).resolves.toEqual({
      userId: "user-456",
      arg1: "hello",
      arg2: 42,
      arg3: true,
    });
  });
});

describe("withLedgerAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs the action with its arguments once the ledger exists", async () => {
    const db = getTestDb();
    mockSession.mockResolvedValue(testSession());
    await createTestUserWithLedger(db);

    const action = withLedgerAccess(async (value: string) => value);

    await expect(action("ok")).resolves.toBe("ok");
  });

  it("refuses before the ledger exists", async () => {
    mockSession.mockResolvedValue(testSession());

    const action = withLedgerAccess(async () => "ok");

    await expect(action()).rejects.toThrow(NotFoundError);
  });
});

describe("requireAuth", () => {
  it("returns the user id when signed in", async () => {
    mockSession.mockResolvedValue(testSession("user-789"));

    await expect(requireAuth()).resolves.toBe("user-789");
  });

  it("throws UnauthorizedError without a session", async () => {
    mockSession.mockResolvedValue(null);

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
    mockSession.mockResolvedValue(
      testSession("user-recent", { authenticatedAt: new Date("2026-08-23T11:50:00.000Z") })
    );

    await expect(requireRecentAuth()).resolves.toBe("user-recent");
  });

  it("requires reauthentication after the ten-minute window", async () => {
    mockSession.mockResolvedValue(
      testSession("user-stale", { authenticatedAt: new Date("2026-08-23T11:49:59.999Z") })
    );

    await expect(requireRecentAuth()).rejects.toMatchObject({
      code: "REAUTHENTICATION_REQUIRED",
    });
  });

  it("requires reauthentication without a session", async () => {
    mockSession.mockResolvedValue(null);

    await expect(requireRecentAuth()).rejects.toMatchObject({
      code: "REAUTHENTICATION_REQUIRED",
    });
  });
});
