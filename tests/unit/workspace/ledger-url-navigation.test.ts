import { afterEach, describe, expect, it, vi } from "vitest";
import { pushLedgerUrl, replaceLedgerUrl } from "@/modules/workspace/ledger-url-navigation";

describe("ledger-url-navigation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, "", "/");
  });

  it("replaceLedgerUrl updates history and returns the built url", () => {
    const historySpy = vi.spyOn(window.history, "replaceState");
    const params = new URLSearchParams("period=thisMonth");

    const url = replaceLedgerUrl("/details", params);

    expect(url).toBe("/details?period=thisMonth");
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
      "/stream"
    );
    const historySpy = vi.spyOn(window.history, "pushState");

    const url = pushLedgerUrl("/stream", new URLSearchParams("period=week"), "filter");

    expect(url).toBe("/stream?period=week");

    expect(historySpy).toHaveBeenCalledWith(
      {
        unrelatedCustomState: "keep",
        cashier: { ledgerNavigation: true, kind: "filter" },
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
      "/details"
    );
    const historySpy = vi.spyOn(window.history, "replaceState");

    const url = replaceLedgerUrl("/details", new URLSearchParams("detail=document-1"));

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
