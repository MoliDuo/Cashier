/**
 * The category structures a ledger can adopt.
 *
 * A preset is a starting point, not a fixed taxonomy: applying one writes
 * ordinary `entry_categories` rows, so the ledger keeps editing them
 * afterwards. The `default` preset is what new ledgers are seeded with.
 *
 * Category names and descriptions are data written into the database, so they
 * live here rather than in the message catalogs. Only the preset's own label
 * and one-line explanation are interface copy (the `Settings` namespace).
 *
 * Order is the array order; nothing here carries a `sortOrder`, because the
 * two writers disagree on indexing (`getDefaultLedger` seeds 1-based rows,
 * `saveEntryCategories` writes 0-based ones) and a third source of truth would
 * only create a mismatch. Consumers that need a stored order index it
 * themselves.
 *
 * This order is the display order for ledgers seeded from here. Rows that
 * already exist keep the `sort_order` they were written with. They change
 * only when the user explicitly applies a preset or reorders categories.
 */

export const CATEGORY_PRESET_IDS = ["default", "concise"] as const;

export type CategoryPresetId = (typeof CATEGORY_PRESET_IDS)[number];

export interface PresetCategory {
  key?: string;
  name: string;
  description: string;
  /** Must be a name in `COMMON_LUCIDE_ICONS`, or the icon silently falls back to `Package`. */
  icon: string;
}

type PresetCategoryDefinition = Omit<PresetCategory, "key">;

const DEFAULT_CATEGORIES_ZH: readonly PresetCategoryDefinition[] = [
  {
    name: "餐饮",
    description: "涵盖日常膳食及饮水支出，包括正餐、烹饪食材、调味品、饮品及零食",
    icon: "Utensils",
  },
  {
    name: "日用",
    description: "涵盖日常居家消耗品支出，如纸品、清洁用品、厨房耗材及其他日用百货",
    icon: "ShoppingCart",
  },
  {
    name: "购物",
    description:
      "用于无法归入日用、服饰、个护或其他明确类别的商品，如数码电子、文具、礼品及杂项商品",
    icon: "ShoppingBag",
  },
  {
    name: "服饰",
    description: "涵盖衣物、鞋靴、箱包、首饰、手表及其他穿戴配饰的购置、清洗与修补",
    icon: "Shirt",
  },
  {
    name: "个护",
    description: "涵盖个人护理及形象管理支出，如洗护、护肤、彩妆、香水、理发及美容服务",
    icon: "Scissors",
  },
  {
    name: "住房",
    description: "涵盖住房相关固定支出，如房租、水电燃气、网络、物业管理及家居修缮",
    icon: "House",
  },
  {
    name: "生活",
    description:
      "涵盖日常生活服务及零散事务支出，如快递寄送、家政保洁、证件办理、通信话费、打印复印及其他生活杂费",
    icon: "Receipt",
  },
  {
    name: "交通",
    description: "涵盖通勤及出行费用，如公共交通、网约车、燃油及停车费",
    icon: "Bus",
  },
  {
    name: "医疗",
    description: "涵盖医疗与健康支出，如药品、诊疗、体检及营养保健品",
    icon: "Stethoscope",
  },
  {
    name: "教育",
    description: "涵盖学习与技能提升支出，如学费、课程培训、书籍教材、考试报名及学习工具",
    icon: "GraduationCap",
  },
  {
    name: "会员",
    description: "涵盖各类会员及订阅支出，如应用订阅、API 配额及健身场馆会费",
    icon: "Crown",
  },
  {
    name: "娱乐",
    description: "涵盖休闲、社交与文化活动支出，如游戏、电影、演出、展览及相关数字服务",
    icon: "Gamepad2",
  },
  {
    name: "人情",
    description: "涵盖红包、礼金、请客、捐赠及其他人情往来支出",
    icon: "Gift",
  },
];

const DEFAULT_CATEGORIES_EN: readonly PresetCategoryDefinition[] = [
  {
    name: "Dining",
    description:
      "Daily food and drink expenses, including meals, cooking ingredients, seasonings, beverages, and snacks",
    icon: "Utensils",
  },
  {
    name: "Household",
    description:
      "Everyday household consumables, such as paper products, cleaning supplies, kitchen supplies, and other household goods",
    icon: "ShoppingCart",
  },
  {
    name: "Shopping",
    description:
      "Goods that do not fit household, clothing, personal care, or another specific category, such as electronics, stationery, gifts, and miscellaneous items",
    icon: "ShoppingBag",
  },
  {
    name: "Clothing",
    description:
      "Clothing, footwear, bags, jewelry, watches, and other wearable accessories, including purchases, cleaning, and repairs",
    icon: "Shirt",
  },
  {
    name: "Personal Care",
    description:
      "Personal care and grooming expenses, such as hair care, skincare, cosmetics, perfume, haircuts, and beauty services",
    icon: "Scissors",
  },
  {
    name: "Housing",
    description:
      "Fixed housing expenses, such as rent, utilities, internet, property management, and home repairs",
    icon: "House",
  },
  {
    name: "Daily Life",
    description:
      "Everyday services and miscellaneous expenses, such as courier delivery, housekeeping, document processing, phone bills, printing, and other odds and ends",
    icon: "Receipt",
  },
  {
    name: "Transport",
    description:
      "Commuting and travel expenses, such as public transit, rideshare, fuel, and parking fees",
    icon: "Bus",
  },
  {
    name: "Healthcare",
    description:
      "Medical and health expenses, such as medication, treatment, checkups, and nutritional supplements",
    icon: "Stethoscope",
  },
  {
    name: "Education",
    description:
      "Learning and skill-development expenses, such as tuition, courses, books, exam fees, and study tools",
    icon: "GraduationCap",
  },
  {
    name: "Memberships",
    description:
      "Membership and subscription expenses, such as app subscriptions, API quotas, and gym memberships",
    icon: "Crown",
  },
  {
    name: "Entertainment",
    description:
      "Leisure, social, and cultural activities, such as games, movies, performances, exhibitions, and related digital services",
    icon: "Gamepad2",
  },
  {
    name: "Gifts & Giving",
    description:
      "Gift money, cash gifts, treating others, donations, and other social-obligation expenses",
    icon: "Gift",
  },
];

const CONCISE_CATEGORIES_ZH: readonly PresetCategoryDefinition[] = [
  {
    name: "吃喝",
    description: "涵盖日常饮食支出，包括正餐、饮品、零食及食材采购",
    icon: "Utensils",
  },
  {
    name: "居家",
    description: "涵盖居住与家用支出，如房租、水电燃气、网络、家居用品及日用消耗品",
    icon: "House",
  },
  {
    name: "出行",
    description: "涵盖通勤与出行支出，如公共交通、网约车、燃油、停车及旅行",
    icon: "Bus",
  },
  {
    name: "健康",
    description: "涵盖医疗保健支出，如药品、诊疗、体检、健身及保健品",
    icon: "Stethoscope",
  },
  {
    name: "娱乐",
    description: "涵盖休闲娱乐支出，如游戏、影音、演出、会员订阅及社交活动",
    icon: "Gamepad2",
  },
  {
    name: "其他",
    description: "涵盖以上类别之外的其他支出，如服饰、数码、教育及人情往来",
    icon: "ShoppingBag",
  },
];

const CONCISE_CATEGORIES_EN: readonly PresetCategoryDefinition[] = [
  {
    name: "Food & Drink",
    description: "Everyday food and drink, including meals, beverages, snacks, and groceries",
    icon: "Utensils",
  },
  {
    name: "Home",
    description:
      "Housing and household expenses, such as rent, utilities, internet, home goods, and everyday consumables",
    icon: "House",
  },
  {
    name: "Travel",
    description:
      "Commuting and travel expenses, such as public transit, rideshare, fuel, parking, and trips",
    icon: "Bus",
  },
  {
    name: "Health",
    description:
      "Healthcare expenses, such as medication, treatment, checkups, fitness, and supplements",
    icon: "Stethoscope",
  },
  {
    name: "Leisure",
    description:
      "Leisure expenses, such as games, media, performances, memberships, and social activities",
    icon: "Gamepad2",
  },
  {
    name: "Other",
    description:
      "Anything outside the categories above, such as clothing, electronics, education, and gifts",
    icon: "ShoppingBag",
  },
];

const CATEGORY_PRESETS: Readonly<
  Record<
    CategoryPresetId,
    { zh: readonly PresetCategoryDefinition[]; en: readonly PresetCategoryDefinition[] }
  >
> = {
  default: { zh: DEFAULT_CATEGORIES_ZH, en: DEFAULT_CATEGORIES_EN },
  concise: { zh: CONCISE_CATEGORIES_ZH, en: CONCISE_CATEGORIES_EN },
};

/** The preset's categories in display order, localized like `getDefaultLedger`. */
export function getCategoryPreset(
  presetId: CategoryPresetId,
  locale: string = "zh"
): readonly (PresetCategory & { key: string })[] {
  const preset = CATEGORY_PRESETS[presetId];
  const definitions = locale.startsWith("zh") ? preset.zh : preset.en;
  const keys =
    presetId === "default"
      ? [
          "dining",
          "household",
          "shopping",
          "clothing",
          "personal-care",
          "housing",
          "daily-life",
          "transport",
          "healthcare",
          "education",
          "memberships",
          "entertainment",
          "gifts",
        ]
      : ["food-drink", "home", "travel", "health", "leisure", "other"];
  return definitions.map((category, index) => ({ ...category, key: keys[index]! }));
}

/** Match only exact built-in names, across both supported data languages. */
export function getPresetSemanticKey(name: string): string | null {
  for (const presetId of CATEGORY_PRESET_IDS) {
    for (const locale of ["zh", "en"] as const) {
      const match = getCategoryPreset(presetId, locale).find((category) => category.name === name);
      if (match != null) return match.key;
    }
  }
  return null;
}
