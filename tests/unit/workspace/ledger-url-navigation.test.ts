import { afterEach, describe, expect, it, vi } from "vitest";
import { pushLedgerUrl, replaceLedgerUrl } from "@/modules/workspace/ledger-url-navigation";

describe("ledger-url-navigation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, "", "/");
  });

  it("replaceLedgerUrl updates history and returns the built url", () => {
    const historySpy = vi.spyOn(window.history, "replaceState");
    const params = new URLSearchParams("tab=details&period=thisMonth");

    const url = replaceLedgerUrl("/ledgers/ledger-1", params);

    expect(url).toBe("/ledgers/ledger-1?tab=details&period=thisMonth");
    expect(historySpy).toHaveBeenCalledWith(
      { cashier: { ledgerNavigation: true, kind: "filter" } },
      "",
      url
    );
  });

  it("pushLedgerUrl excludes Next.js internal state while preserving custom metadata", () => {
    window.history.replaceState(
      {
        __NA: true,
        _N: true,
        __PRIVATE_NEXTJS_INTERNALS_TREE: ["next-router-tree"],
        unrelatedCustomState: "keep",
        cashier: { ledgerNavigation: true, kind: "filter" },
      },
      "",
      "/ledgers/ledger-1?tab=stream"
    );
    const historySpy = vi.spyOn(window.history, "pushState");

    const url = pushLedgerUrl("/ledgers/ledger-1", new URLSearchParams("tab=details"), "tab");

    expect(url).toBe("/ledgers/ledger-1?tab=details");

    expect(historySpy).toHaveBeenCalledWith(
      {
        unrelatedCustomState: "keep",
        cashier: { ledgerNavigation: true, kind: "tab" },
      },
      "",
      url
    );
  });

  it("replaceLedgerUrl excludes Next.js internal state and preserves Cashier history metadata", () => {
    window.history.replaceState(
      {
        __NA: true,
        __PRIVATE_NEXTJS_INTERNALS_TREE: ["next-router-tree"],
        cashier: { ledgerNavigation: true, kind: "detail" },
        unrelatedCustomState: "keep",
      },
      "",
      "/ledgers/ledger-1?tab=details"
    );
    const historySpy = vi.spyOn(window.history, "replaceState");

    const url = replaceLedgerUrl(
      "/ledgers/ledger-1",
      new URLSearchParams("tab=details&detailId=document-1")
    );

    expect(historySpy).toHaveBeenCalledWith(
      {
        cashier: { ledgerNavigation: true, kind: "filter" },
        unrelatedCustomState: "keep",
      },
      "",
      url
    );
  });
});
