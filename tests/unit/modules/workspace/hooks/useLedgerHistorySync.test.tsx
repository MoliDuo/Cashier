import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useModalStackStore } from "@/lib/store/modal-stack";
import { useLedgerHistorySync } from "@/modules/workspace/hooks/useLedgerHistorySync";
import { WorkspaceStoreProvider, useWorkspaceStore } from "@/modules/workspace/store";
import type { LedgerTab } from "@/lib/ledger-tabs";

const detailId = "document-1";
const detailSearch = `detail=${detailId}`;

function wrapper({ children }: { children: ReactNode }) {
  return <WorkspaceStoreProvider initialBookId={null}>{children}</WorkspaceStoreProvider>;
}

function renderSync(activeTab: LedgerTab, search: string) {
  return renderHook(
    ({ tab, query }: { tab: LedgerTab; query: string }) => {
      useLedgerHistorySync({
        activeTab: tab,
        pathname: `/${tab}`,
        searchParams: new URLSearchParams(query),
      });
      return useWorkspaceStore((state) => state.routeQueries);
    },
    { wrapper, initialProps: { tab: activeTab, query: search } }
  );
}

describe("useLedgerHistorySync", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", `/stream?${detailSearch}`);
    useModalStackStore.getState().closeAll();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, "", "/");
    useModalStackStore.getState().closeAll();
  });

  it("opens the detail the URL names and closes it when the URL drops it, without asking", async () => {
    const go = vi.spyOn(window.history, "go");
    const { rerender } = renderSync("stream", detailSearch);

    await waitFor(() =>
      expect(useModalStackStore.getState().stack).toEqual([
        { type: "source-document", id: detailId, returnFocus: null },
      ])
    );

    // Browser back to the list: the sheet closes; history is never pulled back.
    window.history.replaceState({}, "", "/stream");
    rerender({ tab: "stream", query: "" });

    await waitFor(() => expect(useModalStackStore.getState().stack).toEqual([]));
    expect(go).not.toHaveBeenCalled();
  });

  it("remembers each route's query without the open record", () => {
    const { result, rerender } = renderSync("details", `period=lastMonth&${detailSearch}`);
    expect(result.current.details).toBe("period=lastMonth");

    rerender({ tab: "stats", query: "range=year" });
    expect(result.current).toEqual({ details: "period=lastMonth", stats: "range=year" });
  });

  it("drops a custom period it cannot read", async () => {
    const replace = vi.spyOn(window.history, "replaceState");
    renderSync("details", "period=custom&startDate=2026-02-01&categoryId=c1");
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(expect.anything(), "", "/details?categoryId=c1")
    );
  });
});
