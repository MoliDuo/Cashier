import { beforeEach, describe, expect, it, vi } from "vitest";

const { trackMock } = vi.hoisted(() => ({ trackMock: vi.fn() }));

vi.mock("@/lib/telemetry/client", () => ({ track: trackMock }));

import { trackFilterApply, trackPeriodSwitch } from "@/modules/workspace/telemetry";

describe("workspace telemetry", () => {
  beforeEach(() => trackMock.mockReset());

  it("records a calendar period by range and offset", () => {
    trackPeriodSwitch("stats", { range: "month", offset: -2 });

    expect(trackMock).toHaveBeenCalledWith("period.switch", {
      tab: "stats",
      range: "month",
      offset: -2,
    });
  });

  it("records 'all' and a custom range without any of its days", () => {
    trackPeriodSwitch("entries", { range: "all" });
    trackPeriodSwitch("entries", { range: "custom", from: "2026-01-01", to: "2026-01-31" });

    expect(trackMock.mock.calls).toEqual([
      ["period.switch", { tab: "entries", range: "all" }],
      ["period.switch", { tab: "entries", range: "custom" }],
    ]);
  });

  it("records which filters are set, never their values", () => {
    trackFilterApply({
      categoryId: "category-secret-id",
      search: "Cafe Moli",
      minAmount: "12.50",
      statuses: [],
    });

    expect(trackMock).toHaveBeenCalledWith("filter.apply", {
      fields: ["categoryId", "search", "minAmount"],
      count: 3,
    });
    expect(JSON.stringify(trackMock.mock.calls)).not.toMatch(/Cafe|12\.50|secret/);
  });

  it("records clearing every filter as none set", () => {
    trackFilterApply({});

    expect(trackMock).toHaveBeenCalledWith("filter.apply", { fields: [], count: 0 });
  });
});
