import { beforeEach, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({
  getLedgerVersion: vi.fn(),
  getLedgerRefreshBaseline: vi.fn(),
  listTargetSourceDocuments: vi.fn(),
  listLedgerEntryViewsBySourceDocumentIds: vi.fn(),
}));

vi.mock("@/modules/source-document/server/ledger-changes", () => ({
  getLedgerVersion: reads.getLedgerVersion,
  getLedgerRefreshBaseline: reads.getLedgerRefreshBaseline,
}));
vi.mock("@/modules/source-document/server/reads/list", () => ({
  listTargetSourceDocuments: reads.listTargetSourceDocuments,
}));
vi.mock(
  "@/modules/ledger/server/entry-reads/list-ledger-entry-views-by-source-document-ids",
  () => ({
    listLedgerEntryViewsBySourceDocumentIds: reads.listLedgerEntryViewsBySourceDocumentIds,
  })
);

import { listStreamPage } from "@/modules/source-document/server/list-stream-page";

describe("listStreamPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reads.listTargetSourceDocuments.mockResolvedValue({ items: [], nextCursor: null });
    reads.listLedgerEntryViewsBySourceDocumentIds.mockResolvedValue(new Map());
    reads.getLedgerVersion.mockResolvedValue(BigInt(7));
    reads.getLedgerRefreshBaseline.mockResolvedValue({
      version: BigInt(7),
      hasTransitionalWork: false,
    });
  });

  it("propagates version-service failures instead of fabricating generation zero", async () => {
    reads.getLedgerVersion.mockRejectedValue(new Error("version unavailable"));

    await expect(listStreamPage("ledger-1", { limit: 20 })).rejects.toThrow("version unavailable");
    expect(reads.listTargetSourceDocuments).not.toHaveBeenCalled();
  });

  it("requires a restart when the ledger version changes during the page read", async () => {
    reads.getLedgerRefreshBaseline.mockResolvedValue({
      version: BigInt(8),
      hasTransitionalWork: true,
    });

    await expect(listStreamPage("ledger-1", { limit: 20 })).resolves.toEqual({
      items: [],
      nextCursor: null,
      generation: "8",
      hasTransitionalWork: true,
      restartRequired: true,
    });
  });
});
