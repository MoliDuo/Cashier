import { describe, expect, it, vi } from "vitest";
import { listStreamPage } from "@/modules/source-document/application/queries/list-stream-page";

function createPorts() {
  return {
    documents: { list: vi.fn().mockResolvedValue({ items: [], nextCursor: null }) },
    changes: {
      getVersion: vi.fn().mockResolvedValue(BigInt(7)),
      getRefreshBaseline: vi.fn().mockResolvedValue({
        version: BigInt(7),
        hasTransitionalWork: false,
      }),
    },
  };
}

describe("listStreamPage", () => {
  it("propagates version-service failures instead of fabricating generation zero", async () => {
    const ports = createPorts();
    ports.changes.getVersion.mockRejectedValue(new Error("version unavailable"));

    await expect(listStreamPage("ledger-1", { limit: 20 }, ports)).rejects.toThrow(
      "version unavailable"
    );
    expect(ports.documents.list).not.toHaveBeenCalled();
  });

  it("requires a restart when the ledger version changes during the page read", async () => {
    const ports = createPorts();
    ports.changes.getRefreshBaseline.mockResolvedValue({
      version: BigInt(8),
      hasTransitionalWork: true,
    });

    await expect(listStreamPage("ledger-1", { limit: 20 }, ports)).resolves.toEqual({
      items: [],
      nextCursor: null,
      generation: "8",
      hasTransitionalWork: true,
      restartRequired: true,
    });
  });
});
