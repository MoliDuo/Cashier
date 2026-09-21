import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLedgerTabs } from "@/modules/workspace/hooks/useLedgerTabs";

const ROUTER_SYNC_EVENT = "cashier:test-router-sync";

function LedgerNavigationHarness() {
  const [searchParams, setSearchParams] = useState(
    () => new URLSearchParams(window.location.search)
  );
  const { activeTab, handleTabChange } = useLedgerTabs({
    pathname: "/ledgers/ledger-1",
    searchParams,
  });

  useEffect(() => {
    const syncFromLocation = () => {
      setSearchParams(new URLSearchParams(window.location.search));
    };
    window.addEventListener(ROUTER_SYNC_EVENT, syncFromLocation);
    window.addEventListener("popstate", syncFromLocation);
    return () => {
      window.removeEventListener(ROUTER_SYNC_EVENT, syncFromLocation);
      window.removeEventListener("popstate", syncFromLocation);
    };
  }, []);

  return (
    <>
      {(["stream", "details", "stats"] as const).map((tab) => (
        <button
          key={tab}
          type="button"
          aria-current={activeTab === tab ? "page" : undefined}
          onClick={() => handleTabChange(tab)}
        >
          {tab}
        </button>
      ))}
      <div data-testid="active-tab-content">{activeTab}</div>
    </>
  );
}

describe("ledger navigation flow", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState({}, "", "/");
  });

  it("keeps the URL, active navigation, and rendered tab content in sync", () => {
    window.history.replaceState(
      {
        __NA: true,
        __PRIVATE_NEXTJS_INTERNALS_TREE: ["stream-tree"],
      },
      "",
      "/ledgers/ledger-1?tab=stream"
    );
    const originalPushState = window.history.pushState.bind(window.history);
    vi.spyOn(window.history, "pushState").mockImplementation((data, unused, url) => {
      const candidate = data as Record<string, unknown> | null;
      originalPushState(data, unused, url);
      if (candidate?.__NA === true || candidate?._N === true) {
        return;
      }
      window.dispatchEvent(new Event(ROUTER_SYNC_EVENT));
    });

    render(<LedgerNavigationHarness />);

    fireEvent.click(screen.getByRole("button", { name: "details" }));

    expect(window.location.search).toBe("?tab=details");
    expect(window.location.pathname).toBe("/ledgers/ledger-1");
    expect(screen.getByRole("button", { name: "details" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("active-tab-content")).toHaveTextContent("details");

    fireEvent.click(screen.getByRole("button", { name: "stats" }));

    expect(window.location.search).toBe("?tab=stats");
    expect(window.location.pathname).toBe("/ledgers/ledger-1");
    expect(screen.getByRole("button", { name: "stats" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("active-tab-content")).toHaveTextContent("stats");

    act(() => {
      window.history.replaceState(
        {
          __NA: true,
          __PRIVATE_NEXTJS_INTERNALS_TREE: ["details-tree"],
        },
        "",
        "/ledgers/ledger-1?tab=details"
      );
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(screen.getByRole("button", { name: "details" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("active-tab-content")).toHaveTextContent("details");
  });
});
