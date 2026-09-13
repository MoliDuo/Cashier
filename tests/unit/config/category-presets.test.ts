import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COMMON_LUCIDE_ICONS } from "@/config/icons";
import { CATEGORY_PRESET_IDS, getCategoryPreset } from "@/config/category-presets";
import { getDefaultLedger } from "@/config/default-ledger";

const commonIcons: readonly string[] = COMMON_LUCIDE_ICONS;
/** The newest reorder migration; point this at the next one when the order changes. */
const DEFAULT_PRESET_REORDER_MIGRATION = "0042_reorder_default_categories.sql";

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

  /**
   * Existing rows keep the `sort_order` they were written with, so the preset's
   * order only reaches them through the migration. A name missing from it, or a
   * wrong slot, is invisible to every other test — the migration runs while the
   * test schema is built, long before any test could seed a row to check.
   */
  it("reorders existing ledgers onto the same slots the preset declares", () => {
    const sql = readFileSync(
      path.resolve("src/persistence/postgres-migrations", DEFAULT_PRESET_REORDER_MIGRATION),
      "utf8"
    );
    const orderByName = new Map(
      [...sql.matchAll(/\('([^']+)', (\d+)\)/g)].map(([, name, sortOrder]) => [
        name!,
        Number(sortOrder),
      ])
    );
    expect(orderByName.size).toBeGreaterThan(0);

    for (const locale of ["zh-CN", "en"] as const) {
      const preset = getCategoryPreset("default", locale);
      expect(preset.map((category) => orderByName.get(category.name))).toEqual(
        preset.map((_, index) => index + 1)
      );
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
