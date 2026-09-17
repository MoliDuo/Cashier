import { entryCategories, ledgers } from "@/persistence";
import type { LedgerSettingsContract } from "@/application/contracts";

/** lastUsedAt updates are throttled to once per five minutes per credential. */
export const SERVICE_CREDENTIAL_LAST_USED_STALE_MS = 5 * 60 * 1000;

export function toIso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

export function mapLedgerSettings(
  row: Pick<
    typeof ledgers.$inferSelect,
    | "aiLanguage"
    | "preferredCurrencies"
    | "mainCurrency"
    | "collapseEntriesDefault"
    | "aiCustomPrompt"
  >
): LedgerSettingsContract {
  return {
    aiLanguage: row.aiLanguage,
    currencies: row.preferredCurrencies,
    mainCurrency: row.mainCurrency,
    collapseEntriesDefault: row.collapseEntriesDefault,
    aiCustomPrompt: row.aiCustomPrompt,
  };
}

export function settingsColumns(settings: Partial<LedgerSettingsContract>) {
  return {
    ...(settings.aiLanguage === undefined ? {} : { aiLanguage: settings.aiLanguage }),
    ...(settings.currencies === undefined ? {} : { preferredCurrencies: settings.currencies }),
    ...(settings.mainCurrency === undefined ? {} : { mainCurrency: settings.mainCurrency }),
    ...(settings.collapseEntriesDefault === undefined
      ? {}
      : { collapseEntriesDefault: settings.collapseEntriesDefault }),
    ...(settings.aiCustomPrompt === undefined ? {} : { aiCustomPrompt: settings.aiCustomPrompt }),
  };
}

export function mapCategory(row: typeof entryCategories.$inferSelect) {
  return {
    id: row.id,
    ledgerId: row.ledgerId,
    name: row.name,
    description: row.description,
    icon: row.icon,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
