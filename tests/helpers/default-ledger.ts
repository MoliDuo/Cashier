import { getCategoryPreset, type PresetCategory } from "@/config/category-presets";

/**
 * The `default` category preset, plus the settings a new ledger starts with.
 * `getDefaultLedger` is the seeding shape `createDefault` expects; the category
 * text itself lives in `category-presets.ts` so the two presets have one home.
 *
 * Seeded rows are 1-based, which is what the pre-preset ledgers already hold.
 * `PresetCategory` carries no order of its own.
 */
function seedCategories(preset: readonly PresetCategory[]) {
  return preset.map(({ name, description, icon }, index) => ({
    name,
    description,
    icon,
    sortOrder: index + 1,
  }));
}

const defaultLedger = {
  settings: {
    aiLanguage: "zh-CN",
    currencies: ["CNY", "USD"] as string[],
    mainCurrency: "CNY",
    collapseEntriesDefault: false,
    aiCustomPrompt: "",
  },
  categories: seedCategories(getCategoryPreset("default")),
};

export function getDefaultLedger() {
  return defaultLedger;
}
