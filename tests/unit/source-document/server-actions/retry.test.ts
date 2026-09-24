import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

const { retrySourceDocumentMock } = vi.hoisted(() => ({
  retrySourceDocumentMock: vi.fn(),
}));

vi.mock("@/modules/source-document/server-actions/access", () => ({
  withSourceDocumentLedgerAccess:
    <TArgs extends unknown[], TResult>(
      handler: (access: { ledgerId: string }, ...args: TArgs) => TResult
    ) =>
    (...args: TArgs) =>
      handler({ ledgerId: "ledger-1" }, ...args),
}));

vi.mock("@/modules/source-document/application/use-cases/retry-source-document", () => ({
  retrySourceDocument: retrySourceDocumentMock,
}));

vi.mock("@/application/server-composition-root", () => ({
  serverComposition: {
    sourceDocumentAggregate: {
      installRetry: vi.fn(),
    },
    storedFiles: {},
  },
}));

vi.mock("@/application/processing/schedule-processing", () => ({
  scheduleProcessingAfter: vi.fn(),
}));
vi.mock("@/application/processing/schedule-processing-recovery", () => ({
  scheduleProcessingRecoveryAfter: vi.fn(),
}));
vi.mock("@/lib/storage/image-processing", () => ({ processImage: vi.fn() }));

import { retrySourceDocumentAction } from "@/modules/source-document/server-actions/retry";

const sourceDocumentId = "11111111-1111-4111-8111-111111111111";

describe("retrySourceDocumentAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    retrySourceDocumentMock.mockResolvedValue({
      ok: true,
      sourceDocumentId,
      version: 4,
      data: { status: "processing" },
    });
  });

  it("passes the document identity without browser idempotency metadata", async () => {
    await retrySourceDocumentAction(sourceDocumentId, 3);
    expect(retrySourceDocumentMock.mock.calls[0]?.[0]).toEqual({
      ledgerId: "ledger-1",
      sourceDocumentId,
      expectedVersion: 3,
    });
  });

  it("passes stale detection to the transactional submission boundary", async () => {
    retrySourceDocumentMock.mockResolvedValueOnce({
      ok: false,
      reason: "stale",
      sourceDocumentId,
      expectedVersion: 2,
      currentVersion: 3,
    });
    await expect(retrySourceDocumentAction(sourceDocumentId, 2)).resolves.toEqual({
      ok: false,
      reason: "stale",
      sourceDocumentId,
      expectedVersion: 2,
      currentVersion: 3,
    });
  });

  it("validates the source document id and expected version", async () => {
    await expect(retrySourceDocumentAction("not-a-uuid", 3)).rejects.toThrow(ZodError);
    await expect(retrySourceDocumentAction(sourceDocumentId, 0)).rejects.toThrow(ZodError);
  });
});
