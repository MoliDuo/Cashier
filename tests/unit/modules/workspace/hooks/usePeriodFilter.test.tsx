import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { usePeriodFilter } from "@/modules/workspace/hooks/usePeriodFilter";

describe("usePeriodFilter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function createSearchParams(init?: string): URLSearchParams {
    return new URLSearchParams(init ?? "");
  }

  it("includes statuses in filters built from URL state", () => {
    const searchParams = createSearchParams("streamStatuses=cancelled,failed");
    const { result } = renderHook(() =>
      usePeriodFilter({
        pathname: "/ledger/test",
        searchParams,
        scope: "stream",
      })
    );

    expect(result.current.filters.statuses).toEqual(["failed", "cancelled"]);
  });
});
