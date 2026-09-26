import { describe, expect, it } from "vitest";
import { ENTRY_FILTER_PRESETS, resolveActivePreset } from "@/modules/ledger/entry-filter-presets";

describe("resolveActivePreset", () => {
  it("keeps the presets the panel offers", () => {
    for (const preset of ENTRY_FILTER_PRESETS) {
      expect(resolveActivePreset({ period: preset })).toBe(preset);
    }
  });

  it("reads a range the panel cannot express as a hand-picked one", () => {
    expect(resolveActivePreset({ period: "week" })).toBe("custom");
    expect(resolveActivePreset({ period: "3months" })).toBe("custom");
    expect(
      resolveActivePreset({ period: "custom", startDate: "2026-09-01", endDate: "2026-09-10" })
    ).toBe("custom");
  });
});
