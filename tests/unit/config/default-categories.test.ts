import { describe, expect, it } from "vitest";
import { COMMON_LUCIDE_ICONS } from "@/config/icons";
import { DEFAULT_CATEGORIES } from "@/config/default-categories";

const commonIcons: readonly string[] = COMMON_LUCIDE_ICONS;

describe("DEFAULT_CATEGORIES", () => {
  it("gives every category a unique name, a description and a usable icon", () => {
    expect(DEFAULT_CATEGORIES.length).toBeGreaterThan(0);
    for (const category of DEFAULT_CATEGORIES) {
      expect(category.name.trim()).not.toBe("");
      expect(category.description.trim()).not.toBe("");
      expect(commonIcons).toContain(category.icon);
    }
    const names = DEFAULT_CATEGORIES.map((category) => category.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
