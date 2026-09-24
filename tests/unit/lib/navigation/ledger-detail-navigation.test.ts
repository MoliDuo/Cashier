import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openLedgerEntrySourceDocument } from "@/lib/navigation/ledger-detail-navigation";
import { useModalStackStore } from "@/lib/store/modal-stack";

describe("openLedgerEntrySourceDocument", () => {
  beforeEach(() => {
    useModalStackStore.setState({ stack: [] });
    window.history.replaceState({}, "", "/zh/ledger/ledger-1?tab=details");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, "", "/");
    useModalStackStore.setState({ stack: [] });
  });

  it("opens the record the entry belongs to", () => {
    openLedgerEntrySourceDocument({ sourceDocumentId: "document-1", ledgerId: "ledger-1" });

    expect(useModalStackStore.getState().stack).toEqual([
      expect.objectContaining({
        type: "source-document",
        id: "document-1",
        ledgerId: "ledger-1",
      }),
    ]);
  });

  it("writes the record into the URL so a reload reopens the same sheet", () => {
    const pushState = vi.spyOn(window.history, "pushState");

    openLedgerEntrySourceDocument({ sourceDocumentId: "document-1", ledgerId: "ledger-1" });

    expect(pushState).toHaveBeenCalledWith(
      expect.objectContaining({ cashier: expect.objectContaining({ kind: "detail" }) }),
      "",
      "/zh/ledger/ledger-1?tab=details&detailType=source-document&detailId=document-1"
    );
  });

  it("opens nothing for an entry with no record", () => {
    const pushState = vi.spyOn(window.history, "pushState");

    openLedgerEntrySourceDocument({ sourceDocumentId: null, ledgerId: "ledger-1" });

    expect(useModalStackStore.getState().stack).toEqual([]);
    expect(pushState).not.toHaveBeenCalled();
  });
});
