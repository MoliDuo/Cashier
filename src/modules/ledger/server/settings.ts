import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { AppError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { ledgers, sourceDocuments } from "@/persistence";
import { SUPPORTED_CURRENCIES } from "@/config/currencies";
import { omitUndefinedProperties } from "@/lib/validation";
import { ensureExchangeRates } from "@/modules/currency/server/exchange-rates";
import type { UpdateLedgerInput } from "@/modules/ledger/contract-schemas";
import type { LedgerDto, LedgerSettings } from "@/modules/ledger/contracts";

export function mapLedgerSettings(
  row: Pick<
    typeof ledgers.$inferSelect,
    | "aiLanguage"
    | "preferredCurrencies"
    | "mainCurrency"
    | "collapseEntriesDefault"
    | "aiCustomPrompt"
  >
): LedgerSettings {
  return {
    aiLanguage: row.aiLanguage,
    currencies: row.preferredCurrencies,
    mainCurrency: row.mainCurrency,
    collapseEntriesDefault: row.collapseEntriesDefault,
    aiCustomPrompt: row.aiCustomPrompt,
  };
}

function settingsColumns(settings: Partial<LedgerSettings>) {
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

export async function getLedgerSettings(ledgerId: string): Promise<LedgerSettings | null> {
  const ledger = await db.query.ledgers.findFirst({
    where: eq(ledgers.id, ledgerId),
    columns: {
      aiLanguage: true,
      preferredCurrencies: true,
      mainCurrency: true,
      collapseEntriesDefault: true,
      aiCustomPrompt: true,
    },
  });
  return ledger == null ? null : mapLedgerSettings(ledger);
}

async function updateSettingsRow(input: {
  ledgerId: string;
  expectedUpdatedAt: string;
  settings: Partial<LedgerSettings>;
}): Promise<{ ledger: LedgerDto; mainCurrencyChanged: boolean } | null> {
  return db.transaction(async (tx) => {
    const ledger = await tx
      .select()
      .from(ledgers)
      .where(eq(ledgers.id, input.ledgerId))
      .for("update")
      .then((rows) => rows[0]);
    if (ledger == null) return null;
    const expectedUpdatedAt = new Date(input.expectedUpdatedAt);
    if (
      !Number.isFinite(expectedUpdatedAt.getTime()) ||
      expectedUpdatedAt.getTime() !== ledger.updatedAt.getTime()
    ) {
      throw new ConflictError("Ledger settings changed since they were loaded");
    }
    const settings = { ...mapLedgerSettings(ledger), ...input.settings };
    const previousMainCurrency = ledger.mainCurrency;
    const nextMainCurrency = settings.mainCurrency.trim().toUpperCase();
    const nextCurrencies = settings.currencies.map((currency) => currency.trim().toUpperCase());
    if (!SUPPORTED_CURRENCIES.includes(nextMainCurrency as (typeof SUPPORTED_CURRENCIES)[number])) {
      throw new AppError(`Currency not found: ${nextMainCurrency}`, "CURRENCY_NOT_FOUND", 400);
    }
    for (const currency of nextCurrencies) {
      if (!SUPPORTED_CURRENCIES.includes(currency as (typeof SUPPORTED_CURRENCIES)[number])) {
        throw new AppError(`Currency not found: ${currency}`, "CURRENCY_NOT_FOUND", 400);
      }
    }
    if (
      (input.settings.mainCurrency !== undefined || input.settings.currencies !== undefined) &&
      !nextCurrencies.includes(nextMainCurrency)
    ) {
      throw new ValidationError("Main currency must be included in preferred currencies");
    }
    const updatedAt = new Date(Math.max(Date.now(), ledger.updatedAt.getTime() + 1));
    const updated = await tx
      .update(ledgers)
      .set({
        ...settingsColumns({
          ...settings,
          currencies: nextCurrencies,
          mainCurrency: nextMainCurrency,
        }),
        updatedAt,
      })
      .where(eq(ledgers.id, input.ledgerId))
      .returning()
      .then((rows) => rows[0]);
    if (updated == null) throw new ConflictError("Failed to update ledger settings");
    return {
      ledger: {
        id: updated.id,
        settings: mapLedgerSettings(updated),
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      },
      mainCurrencyChanged: previousMainCurrency !== nextMainCurrency,
    };
  });
}

/**
 * A ledger that only ever recorded its old main currency may have no rates
 * for its days; once the main currency changes every entry converts, so the
 * rates for all its document days are fetched. Best effort: a day still
 * missing reads as unconverted until maintenance fills it.
 */
async function ensureExchangeRatesForLedger(ledgerId: string): Promise<void> {
  const rows = await db
    .selectDistinct({ effectiveDate: sourceDocuments.effectiveDate })
    .from(sourceDocuments)
    .where(eq(sourceDocuments.ledgerId, ledgerId));
  await ensureExchangeRates(rows.map((row) => row.effectiveDate));
}

export async function updateLedgerSettings(
  ledgerId: string,
  data: UpdateLedgerInput
): Promise<LedgerDto> {
  const updated = await updateSettingsRow({
    ledgerId,
    expectedUpdatedAt: data.expectedUpdatedAt,
    settings: omitUndefinedProperties(data.settings ?? {}),
  });
  if (updated == null) throw new NotFoundError("Ledger");
  if (updated.mainCurrencyChanged) await ensureExchangeRatesForLedger(ledgerId);
  return updated.ledger;
}
