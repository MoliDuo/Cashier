import { describe, expect, it } from "vitest";
import { COMMON_LUCIDE_ICONS } from "@/config/icons";
import { CATEGORY_PRESET_IDS, getCategoryPreset } from "@/config/category-presets";
import { getDefaultLedger } from "@/config/default-ledger";

const commonIcons: readonly string[] = COMMON_LUCIDE_ICONS;

describe("getCategoryPreset", () => {
  it("keeps the default preset aligned with the seeded ledger categories", () => {
    for (const locale of ["zh-CN", "en"] as const) {
      const preset = getCategoryPreset("default", locale);
      const seeded = getDefaultLedger(locale).categories;
      expect(preset.map((category) => category.name)).toEqual(
        seeded.map((category) => category.name)
      );
      expect(preset.map((category) => category.description)).toEqual(
        seeded.map((category) => category.description)
      );
      expect(preset.map((category) => category.icon)).toEqual(
        seeded.map((category) => category.icon)
      );
    }
  });

  it("keeps the concise preset structurally aligned across locales", () => {
    const zh = getCategoryPreset("concise", "zh-CN");
    const en = getCategoryPreset("concise", "en");

    expect(zh).toHaveLength(6);
    expect(en).toHaveLength(6);
    expect(en.map((category) => category.icon)).toEqual(zh.map((category) => category.icon));
  });

  it("keeps the default preset at the size its own copy advertises", () => {
    expect(getCategoryPreset("default", "zh-CN")).toHaveLength(13);
    expect(getCategoryPreset("default", "en")).toHaveLength(13);
  });

  it("gives every built-in category a stable semantic key across locales", () => {
    for (const presetId of CATEGORY_PRESET_IDS) {
      const zh = getCategoryPreset(presetId, "zh-CN");
      const en = getCategoryPreset(presetId, "en");
      expect(zh.map((category) => category.key)).toEqual(en.map((category) => category.key));
      expect(new Set(zh.map((category) => category.key)).size).toBe(zh.length);
    }
  });

  it("gives every preset category a usable icon and description", () => {
    for (const presetId of CATEGORY_PRESET_IDS) {
      for (const locale of ["zh-CN", "en"] as const) {
        const preset = getCategoryPreset(presetId, locale);
        expect(preset.length).toBeGreaterThan(0);
        for (const category of preset) {
          expect(category.name.trim()).not.toBe("");
          expect(category.description.trim()).not.toBe("");
          expect(commonIcons).toContain(category.icon);
        }
        const names = preset.map((category) => category.name);
        expect(new Set(names).size).toBe(names.length);
      }
    }
  });

  it("defaults to Chinese and falls back to English for other locales", () => {
    expect(getCategoryPreset("concise", "fr")).toEqual(getCategoryPreset("concise", "en"));
    expect(getCategoryPreset("concise")).toEqual(getCategoryPreset("concise", "zh"));
  });
});
