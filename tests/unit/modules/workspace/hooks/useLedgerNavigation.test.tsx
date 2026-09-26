import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLedgerNavigation } from "@/modules/workspace/hooks/useLedgerNavigation";
import { WorkspaceStoreProvider, useWorkspaceStore } from "@/modules/workspace/store";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }));
const pathname = vi.hoisted(() => ({ current: "/stream" }));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => pathname.current,
}));

function wrapper({ children }: { children: ReactNode }) {
  return <WorkspaceStoreProvider initialBookId={null}>{children}</WorkspaceStoreProvider>;
}

function useHarness() {
  return {
    navigation: useLedgerNavigation(),
    remember: useWorkspaceStore((state) => state.rememberRouteQuery),
  };
}

describe("useLedgerNavigation", () => {
  beforeEach(() => {
    pathname.current = "/stream";
    window.history.replaceState({}, "", "/stream");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("reads the active tab from the route", () => {
    pathname.current = "/stats";
    const { result } = renderHook(useHarness, { wrapper });
    expect(result.current.navigation.activeTab).toBe("stats");
  });

  it("returns to a tab on the query it was left with", () => {
    const { result } = renderHook(useHarness, { wrapper });
    act(() => result.current.remember("details", "period=lastMonth&categoryId=c1"));

    expect(result.current.navigation.hrefFor("details")).toBe(
      "/details?period=lastMonth&categoryId=c1"
    );
    act(() => result.current.navigation.navigate("details"));
    expect(router.push).toHaveBeenCalledWith("/details?period=lastMonth&categoryId=c1", {
      scroll: false,
    });
  });

  it("goes to an explicit query instead of the remembered one", () => {
    const { result } = renderHook(useHarness, { wrapper });
    act(() => result.current.remember("details", "period=lastMonth"));
    act(() =>
      result.current.navigation.navigate("details", new URLSearchParams("period=thisYear"))
    );
    expect(router.push).toHaveBeenCalledWith("/details?period=thisYear", { scroll: false });
  });

  it("replaces an open record's history entry so Back cannot reopen it", () => {
    window.history.replaceState({}, "", "/stream?detail=doc-1");
    const { result } = renderHook(useHarness, { wrapper });
    act(() => result.current.navigation.navigate("stats"));
    expect(router.replace).toHaveBeenCalledWith("/stats", { scroll: false });
    expect(router.push).not.toHaveBeenCalled();
  });
});
