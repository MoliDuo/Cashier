import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from "@/lib/errors";

const { requireLedgerAccessMock } = vi.hoisted(() => ({
  requireLedgerAccessMock: vi.fn(),
}));

vi.mock("@/modules/ledger/access", () => ({
  requireLedgerAccess: requireLedgerAccessMock,
}));

import { withSourceDocumentLedgerAccess } from "@/modules/source-document/server-actions/access";

describe("withSourceDocumentLedgerAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("preserves NotFoundError from requireLedgerAccess", async () => {
    const notFound = new NotFoundError("Ledger");
    requireLedgerAccessMock.mockRejectedValue(notFound);

    const wrapped = withSourceDocumentLedgerAccess(async () => "ok");
    await expect(wrapped()).rejects.toBe(notFound);
    await expect(wrapped()).rejects.not.toBeInstanceOf(UnauthorizedError);
  });

  it("preserves ForbiddenError from requireLedgerAccess", async () => {
    const forbidden = new ForbiddenError("Forbidden");
    requireLedgerAccessMock.mockRejectedValue(forbidden);

    const wrapped = withSourceDocumentLedgerAccess(async () => "ok");
    await expect(wrapped()).rejects.toBe(forbidden);
    await expect(wrapped()).rejects.not.toBeInstanceOf(UnauthorizedError);
  });

  it("preserves ValidationError from requireLedgerAccess", async () => {
    const validation = new ValidationError("Invalid ledger id");
    requireLedgerAccessMock.mockRejectedValue(validation);

    const wrapped = withSourceDocumentLedgerAccess(async () => "ok");
    await expect(wrapped()).rejects.toBe(validation);
    await expect(wrapped()).rejects.not.toBeInstanceOf(UnauthorizedError);
  });
});
