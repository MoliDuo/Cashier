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
    const searchParams = createSearchParams("statuses=cancelled,failed");
    const { result } = renderHook(() =>
      usePeriodFilter({
        pathname: "/ledger/test",
        searchParams,
      })
    );

    expect(result.current.filters.statuses).toEqual(["failed", "cancelled"]);
  });
});
