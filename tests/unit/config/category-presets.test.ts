import { describe, expect, it } from "vitest";
import { COMMON_LUCIDE_ICONS } from "@/config/icons";
import { CATEGORY_PRESET_IDS, getCategoryPreset } from "@/config/category-presets";
import { getDefaultLedger } from "tests/helpers/default-ledger";

const commonIcons: readonly string[] = COMMON_LUCIDE_ICONS;

describe("getCategoryPreset", () => {
  it("keeps the default preset aligned with the seeded ledger categories", () => {
    const preset = getCategoryPreset("default");
    const seeded = getDefaultLedger().categories;

    expect(preset.map((category) => category.name)).toEqual(
      seeded.map((category) => category.name)
    );
    expect(preset.map((category) => category.description)).toEqual(
      seeded.map((category) => category.description)
    );
    expect(preset.map((category) => category.icon)).toEqual(
      seeded.map((category) => category.icon)
    );
  });

  it("keeps each preset at the size its own copy advertises", () => {
    expect(getCategoryPreset("default")).toHaveLength(13);
    expect(getCategoryPreset("concise")).toHaveLength(6);
  });

  it("gives every built-in category a distinct semantic key", () => {
    for (const presetId of CATEGORY_PRESET_IDS) {
      const preset = getCategoryPreset(presetId);
      expect(new Set(preset.map((category) => category.key)).size).toBe(preset.length);
    }
  });

  it("gives every preset category a usable icon and description", () => {
    for (const presetId of CATEGORY_PRESET_IDS) {
      const preset = getCategoryPreset(presetId);
      expect(preset.length).toBeGreaterThan(0);
      for (const category of preset) {
        expect(category.name.trim()).not.toBe("");
        expect(category.description.trim()).not.toBe("");
        expect(commonIcons).toContain(category.icon);
      }
      const names = preset.map((category) => category.name);
      expect(new Set(names).size).toBe(names.length);
    }
  });
});
