import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireLedgerAccessMock, assignBookMock } = vi.hoisted(() => ({
  requireLedgerAccessMock: vi.fn(),
  assignBookMock: vi.fn(),
}));

vi.mock("@/modules/ledger/access", () => ({
  requireLedgerAccess: requireLedgerAccessMock,
  withLedgerAccess:
    <TArgs extends unknown[], TResult>(handler: (ledgerId: string, ...args: TArgs) => TResult) =>
    (...args: TArgs) =>
      handler("ledger-1", ...args),
}));

vi.mock("@/application/server-composition-root", () => ({
  serverComposition: {
    sourceDocumentAggregate: {
      assignBook: assignBookMock,
    },
  },
}));

import { assignSourceDocumentBookAction } from "@/modules/source-document/server-actions/book";
import { ConflictError, ValidationError } from "@/lib/errors";

const LEDGER_ID = "11111111-1111-4111-8111-111111111111";
const SOURCE_DOCUMENT_ID = "22222222-2222-4222-8222-222222222222";
const BOOK_ID = "33333333-3333-4333-8333-333333333333";

const input = {
  sourceDocumentId: SOURCE_DOCUMENT_ID,
  expectedVersion: 3,
  bookId: BOOK_ID,
};

/**
 * The three ways moving a record between books can fail are told apart, because
 * the reader's next action differs: reload for a conflict, pick another book for
 * a retired one, and nothing at all for a record that is gone.
 */
describe("assignSourceDocumentBookAction failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireLedgerAccessMock.mockResolvedValue({
      ledger: { id: LEDGER_ID, settings: { mainCurrency: "CNY" } },
      userId: "user-1",
    });
  });

  it("reports a version conflict as a conflict, not a missing record", async () => {
    assignBookMock.mockResolvedValue({ ok: false, reason: "stale", currentVersion: 4 });

    // A record that was edited elsewhere exists; the caller is looking at an
    // older copy of it, so "not found" would send them hunting for a lost record.
    await expect(assignSourceDocumentBookAction(input)).rejects.toThrow(ConflictError);
  });

  it("reports a book that was archived under the reader as a validation failure", async () => {
    assignBookMock.mockResolvedValue({ ok: false, reason: "book_unavailable" });

    await expect(assignSourceDocumentBookAction(input)).rejects.toThrow(ValidationError);
  });

  it("returns the new version on success", async () => {
    assignBookMock.mockResolvedValue({ ok: true, version: 4 });

    await expect(assignSourceDocumentBookAction(input)).resolves.toEqual({
      bookId: BOOK_ID,
      version: 4,
    });
  });
});
