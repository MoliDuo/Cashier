import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireAuth } from "@/modules/auth/server/session-guards";
import { withLedgerAccess } from "@/modules/ledger/access";
import { NotFoundError, UnauthorizedError } from "@/lib/errors";
import { getTestDb } from "tests/setup";
import { createTestLedger } from "tests/helpers/schema-setup";
import { testSession } from "tests/helpers/session";

vi.mock("@/modules/auth/server/current-session", () => ({ getCurrentSession: vi.fn() }));

import { getCurrentSession } from "@/modules/auth/server/current-session";

const mockSession = vi.mocked(getCurrentSession);

describe("withLedgerAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs the action with its arguments once the ledger exists", async () => {
    const db = getTestDb();
    mockSession.mockResolvedValue(testSession());
    await createTestLedger(db);

    const action = withLedgerAccess(async (value: string) => value);

    await expect(action("ok")).resolves.toBe("ok");
  });

  it("refuses before the ledger exists", async () => {
    mockSession.mockResolvedValue(testSession());

    const action = withLedgerAccess(async () => "ok");

    await expect(action()).rejects.toThrow(NotFoundError);
  });

  it("refuses without a session", async () => {
    mockSession.mockResolvedValue(null);

    const action = withLedgerAccess(async () => "ok");

    await expect(action()).rejects.toThrow(UnauthorizedError);
  });
});

describe("requireAuth", () => {
  it("returns the session when signed in", async () => {
    const session = testSession({ email: "someone@example.com" });
    mockSession.mockResolvedValue(session);

    await expect(requireAuth()).resolves.toBe(session);
  });

  it("throws UnauthorizedError without a session", async () => {
    mockSession.mockResolvedValue(null);

    await expect(requireAuth()).rejects.toThrow(UnauthorizedError);
  });
});
