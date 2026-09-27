import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeLedgerDetail,
  openLedgerDetail,
  openLedgerEntrySourceDocument,
} from "@/lib/navigation/ledger-detail-navigation";

const pushed = { cashier: { ledgerNavigation: true, kind: "detail" } };

describe("ledger detail navigation", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/details?range=week");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, "", "/");
  });

  it("writes the record into the URL as a history entry of its own", () => {
    const pushState = vi.spyOn(window.history, "pushState");

    openLedgerEntrySourceDocument({ sourceDocumentId: "document-1" });

    expect(pushState).toHaveBeenCalledWith(
      expect.objectContaining(pushed),
      "",
      "/details?range=week&detail=document-1"
    );
  });

  it("opens nothing for an entry with no record", () => {
    const pushState = vi.spyOn(window.history, "pushState");

    openLedgerEntrySourceDocument({ sourceDocumentId: null });

    expect(pushState).not.toHaveBeenCalled();
  });

  it("replaces an open record instead of stacking a second one", () => {
    window.history.replaceState(pushed, "", "/details?range=week&detail=document-1");
    const pushState = vi.spyOn(window.history, "pushState");
    const replaceState = vi.spyOn(window.history, "replaceState");

    openLedgerDetail("document-2");

    expect(pushState).not.toHaveBeenCalled();
    expect(replaceState).toHaveBeenCalledWith(
      expect.objectContaining(pushed),
      "",
      "/details?range=week&detail=document-2"
    );
  });

  it("keeps a linked record's entry unmarked when it is replaced, so closing stays in the app", () => {
    window.history.replaceState({}, "", "/details?detail=document-1");

    openLedgerDetail("document-2");

    expect(window.history.state).toMatchObject({ cashier: { kind: "filter" } });
  });

  it("closes a record it pushed by going back", () => {
    window.history.replaceState(pushed, "", "/details?range=week&detail=document-1");
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);

    closeLedgerDetail();

    expect(back).toHaveBeenCalledOnce();
  });

  it("closes a linked record by replacing its parameter away", () => {
    window.history.replaceState({}, "", "/details?range=week&detail=document-1");
    const back = vi.spyOn(window.history, "back");

    closeLedgerDetail();

    expect(back).not.toHaveBeenCalled();
    expect(window.location.search).toBe("?range=week");
  });
});
