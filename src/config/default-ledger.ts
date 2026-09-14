import { getCategoryPreset, type PresetCategory } from "./category-presets";

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

const zhLedger = {
  settings: {
    aiLanguage: "zh-CN",
    currencies: ["CNY", "USD"] as string[],
    mainCurrency: "CNY",
    collapseEntriesDefault: false,
    aiCustomPrompt: "",
    timeZone: null,
  },
  categories: seedCategories(getCategoryPreset("default", "zh")),
};

const enLedger = {
  settings: {
    aiLanguage: "en",
    currencies: ["USD", "EUR", "GBP"] as string[],
    mainCurrency: "USD",
    collapseEntriesDefault: false,
    aiCustomPrompt: "",
    timeZone: null,
  },
  categories: seedCategories(getCategoryPreset("default", "en")),
};

export function getDefaultLedger(locale: string = "zh") {
  if (locale.startsWith("zh")) return zhLedger;
  return enLedger;
}
