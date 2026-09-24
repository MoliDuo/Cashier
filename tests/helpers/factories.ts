import { randomUUID } from "node:crypto";
import { TEST_USER_ID } from "./schema-setup";

export function createLedgerData(
  overrides: Partial<{
    id: string;
    userId: string;
    aiLanguage: string;
    preferredCurrencies: string[];
    mainCurrency: string;
    collapseEntriesDefault: boolean;
    aiCustomPrompt: string;
    createdAt: Date;
    updatedAt: Date;
  }> = {}
) {
  return {
    id: randomUUID(),
    userId: TEST_USER_ID, // 默认使用测试用户，避免外键约束失败
    aiLanguage: "zh-CN",
    preferredCurrencies: [],
    mainCurrency: "CNY",
    collapseEntriesDefault: false,
    aiCustomPrompt: "",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function createCategoryData(
  ledgerId: string,
  overrides: Partial<{
    id: string;
    name: string;
    description: string | null;
    icon: string | null;
    sortOrder: number;
    createdAt: Date;
    updatedAt: Date;
  }> = {}
) {
  return {
    id: randomUUID(),
    ledgerId,
    name: "餐饮",
    description: "外卖、堂食、食材采购",
    icon: "🍽️",
    sortOrder: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

export function createLedgerEntryData(
  ledgerId: string,
  overrides: Partial<{
    id: string;
    categoryId: string | null;
    sourceDocumentId: string | null;
    amount: string;
    currency: string;
    itemName: string;
    description: string | null;
    entryDate: string | null; // yyyy-MM-dd format
    convertedAmount: string | null;
    exchangeRate: string | null;
    createdAt: Date;
  }> = {}
) {
  // sourceDocumentId is required by schema, so generate one if not provided
  const sourceDocumentId = overrides.sourceDocumentId ?? randomUUID();

  return {
    id: randomUUID(),
    ledgerId,
    categoryId: null,
    sourceDocumentId,
    amount: "25.50",
    currency: "CNY",
    itemName: "午餐",
    description: null,
    entryDate: null,
    convertedAmount: null,
    exchangeRate: null,
    createdAt: new Date(),
    ...overrides,
  };
}

export function createSourceDocumentData(
  ledgerId: string,
  overrides: Partial<{
    id: string;
    title: string | null;
    text: string | null;
    imageUrls: string[];
    metadata: Record<string, unknown>;
    status: "processing" | "completed" | "invalid" | "failed" | "cancelled" | "deleted";
    documentDate: string | null;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
  }> = {}
) {
  const now = new Date();
  const {
    text: _text,
    imageUrls: _imageUrls,
    metadata: _metadata,
    status = "completed",
    deletedAt,
    ...canonicalOverrides
  } = overrides;
  return {
    id: randomUUID(),
    ledgerId,
    title: null,
    documentDate: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: status === "deleted" ? (deletedAt ?? now) : (deletedAt ?? null),
    ...canonicalOverrides,
  };
}
