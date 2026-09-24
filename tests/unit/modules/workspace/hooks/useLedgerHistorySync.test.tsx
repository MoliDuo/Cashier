import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useModalStackStore } from "@/lib/store/modal-stack";
import { useUnsavedChangesStore } from "@/lib/store/unsaved-changes";
import { useLedgerHistorySync } from "@/modules/workspace/hooks/useLedgerHistorySync";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import "@/instrumentation-client";

const ledgerId = "ledger-1";
const detailId = "document-1";
const detailSearch = `detailType=source-document&detailId=${detailId}`;
const guardKey = `source-document-detail:${ledgerId}:${detailId}`;

describe("useLedgerHistorySync", () => {
  beforeEach(() => {
    window.history.replaceState(
      { cashier: { ledgerNavigation: true, kind: "detail", sequence: 1 } },
      "",
      `/ledger/${ledgerId}?${detailSearch}`
    );
    useModalStackStore.getState().closeAll();
    useUnsavedChangesStore.setState({
      dirtyKeys: new Set(),
      leaveGuards: new Map(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, "", "/");
    useModalStackStore.getState().closeAll();
    useUnsavedChangesStore.setState({
      dirtyKeys: new Set(),
      leaveGuards: new Map(),
    });
  });

  it("restores a dirty detail before prompting and continues back only after approval", async () => {
    let continueNavigation: (() => void) | null = null;
    const requestLeave = vi.fn((continuation: () => void) => {
      continueNavigation = continuation;
    });
    const go = vi.spyOn(window.history, "go").mockImplementation(() => {});

    useUnsavedChangesStore.getState().registerLeaveGuard(guardKey, { requestLeave });

    renderHook(() =>
      useLedgerHistorySync({
        pathname: `/ledger/${ledgerId}`,
        searchParams: new URLSearchParams(detailSearch),
        ledgerId,
      })
    );

    await waitFor(() =>
      expect(useModalStackStore.getState().stack).toEqual([
        { type: "source-document", id: detailId, ledgerId, returnFocus: null },
      ])
    );

    act(() => {
      const state = { cashier: { ledgerNavigation: true, kind: "filter", sequence: 0 } };
      window.history.replaceState(state, "", `/ledger/${ledgerId}`);
      window.dispatchEvent(new PopStateEvent("popstate", { state }));
    });

    expect(go).toHaveBeenCalledWith(1);
    expect(requestLeave).not.toHaveBeenCalled();

    act(() => {
      const state = { cashier: { ledgerNavigation: true, kind: "detail", sequence: 1 } };
      window.history.replaceState(state, "", `/ledger/${ledgerId}?${detailSearch}`);
      window.dispatchEvent(new PopStateEvent("popstate", { state }));
    });

    expect(requestLeave).toHaveBeenCalledTimes(1);
    expect(continueNavigation).not.toBeNull();

    act(() => {
      continueNavigation?.();
    });

    expect(go).toHaveBeenLastCalledWith(-1);

    act(() => {
      const state = { cashier: { ledgerNavigation: true, kind: "filter", sequence: 0 } };
      window.dispatchEvent(new PopStateEvent("popstate", { state }));
    });

    expect(go).toHaveBeenCalledTimes(2);
    expect(requestLeave).toHaveBeenCalledTimes(1);
  });

  it("intercepts the router before hook mount and releases it after approval or unmount", () => {
    const router = vi.fn(() => useModalStackStore.getState().closeAll());
    window.addEventListener("popstate", router);
    const go = vi.spyOn(window.history, "go").mockImplementation(() => {});
    let leave: (() => void) | undefined;
    useUnsavedChangesStore.getState().registerLeaveGuard("source-document-retry-navigation", {
      requestLeave: (continuation) => {
        leave = continuation;
      },
    });
    const hook = renderHook(() =>
      useLedgerHistorySync({
        pathname: `/ledger/${ledgerId}`,
        searchParams: new URLSearchParams(detailSearch),
        ledgerId,
      })
    );
    try {
      act(() =>
        window.dispatchEvent(new PopStateEvent("popstate", { state: { cashier: { sequence: 0 } } }))
      );
      expect(router).not.toHaveBeenCalled();
      expect(useModalStackStore.getState().stack).toHaveLength(1);
      expect(go).toHaveBeenCalledWith(1);
      act(() =>
        window.dispatchEvent(new PopStateEvent("popstate", { state: { cashier: { sequence: 1 } } }))
      );
      expect(router).not.toHaveBeenCalled();
      expect(leave).toBeTypeOf("function");
      act(() => leave?.());
      act(() =>
        window.dispatchEvent(new PopStateEvent("popstate", { state: { cashier: { sequence: 0 } } }))
      );
      expect(router).toHaveBeenCalledTimes(1);
      hook.unmount();
      act(() => window.dispatchEvent(new PopStateEvent("popstate")));
      expect(router).toHaveBeenCalledTimes(2);
    } finally {
      hook.unmount();
      window.removeEventListener("popstate", router);
    }
  });

  it.each([false, true])(
    "preserves the detail and retry draft on browser back (submitting=%s)",
    (isBlocked) => {
      const go = vi.spyOn(window.history, "go").mockImplementation(() => {});
      const sizes: number[] = [];
      const unsubscribe = useModalStackStore.subscribe((state) => sizes.push(state.stack.length));
      const { result, rerender } = renderHook(
        ({ search }) => {
          const guard = useUnsavedChangesGuard({
            key: "source-document-retry-navigation",
            hasUnsavedChanges: true,
            isBlocked,
          });
          useLedgerHistorySync({
            pathname: `/ledger/${ledgerId}`,
            searchParams: new URLSearchParams(search),
            ledgerId,
          });
          return guard;
        },
        { initialProps: { search: detailSearch } }
      );
      act(() => {
        const state = { cashier: { sequence: 0 } };
        window.history.replaceState(state, "", `/ledger/${ledgerId}`);
        window.dispatchEvent(new PopStateEvent("popstate", { state }));
      });
      rerender({ search: "" });
      expect(useModalStackStore.getState().stack).toHaveLength(1);
      expect(go).toHaveBeenCalledWith(1);
      act(() => {
        const state = { cashier: { sequence: 1 } };
        window.history.replaceState(state, "", `/ledger/${ledgerId}?${detailSearch}`);
        window.dispatchEvent(new PopStateEvent("popstate", { state }));
      });
      rerender({ search: detailSearch });
      expect(result.current.confirmOpen).toBe(!isBlocked);
      expect(useModalStackStore.getState().stack).toHaveLength(1);
      expect(sizes).not.toContain(0);
      unsubscribe();
      expect(go).toHaveBeenCalledTimes(1);
      if (!isBlocked) {
        act(() => result.current.resolveLeave()?.());
        expect(go).toHaveBeenLastCalledWith(-1);
      }
    }
  );
});
