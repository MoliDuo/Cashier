import "server-only";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { AppError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { currencyRates, ledgerEntries, ledgers, sourceDocuments } from "@/persistence";
import { SUPPORTED_CURRENCIES } from "@/config/currencies";
import { omitUndefinedProperties } from "@/lib/validation";
import { runWithConcurrency } from "@/lib/concurrency";
import { recalculateCurrentEntries } from "@/modules/source-document/server/projections/recalculate-current-entries";
import { getExchangeRates } from "@/modules/currency/server/exchange-rates";
import type { UpdateLedgerInput } from "@/modules/ledger/contract-schemas";
import type { LedgerDto, LedgerSettings } from "@/modules/ledger/contracts";

const RATE_PREFETCH_CONCURRENCY = 4;

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
    where: and(eq(ledgers.id, ledgerId), isNull(ledgers.deletedAt)),
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

/**
 * Read-only lookup of the ledger's current main currency and the distinct
 * entry dates its live entries need an exchange rate for.
 */
async function getRequiredExchangeRateDates(
  ledgerId: string
): Promise<{ currentMainCurrency: string; dates: string[] } | null> {
  const ledger = await db.query.ledgers.findFirst({
    where: and(eq(ledgers.id, ledgerId), isNull(ledgers.deletedAt)),
    columns: { mainCurrency: true },
  });
  if (ledger == null) return null;

  // Mirrors the entries join in recalculateCurrentEntries (below) with no
  // entryDate filter, matching the full-ledger recalculation a
  // main-currency change triggers.
  const rows = await db
    .selectDistinct({ entryDate: sourceDocuments.documentDate })
    .from(ledgerEntries)
    .innerJoin(
      sourceDocuments,
      and(
        eq(sourceDocuments.ledgerId, ledgerId),
        eq(sourceDocuments.id, ledgerEntries.sourceDocumentId),
        or(
          eq(sourceDocuments.activeRevisionId, ledgerEntries.sourceDocumentRevisionId),
          eq(sourceDocuments.latestSubmissionRevisionId, ledgerEntries.sourceDocumentRevisionId)
        ),
        isNull(sourceDocuments.deletedAt)
      )
    )
    .where(and(eq(ledgerEntries.ledgerId, ledgerId), isNull(ledgerEntries.deletedAt)));

  const dates = rows.map((row) => row.entryDate).filter((date): date is string => date != null);

  return { currentMainCurrency: ledger.mainCurrency, dates };
}

async function updateWithCurrencyRecalculation(input: {
  ledgerId: string;
  expectedUpdatedAt: string;
  settings: Partial<LedgerSettings>;
}): Promise<LedgerDto | null> {
  return db.transaction(async (tx) => {
    // Lock the ledger row to serialise with concurrent first-entry creation.
    // This prevents a main-currency change from interleaving with activateRevision / createManual.
    const ledger = await tx
      .select()
      .from(ledgers)
      .where(and(eq(ledgers.id, input.ledgerId), isNull(ledgers.deletedAt)))
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
    if (previousMainCurrency !== nextMainCurrency) {
      const latestRate = await tx
        .select({ base: currencyRates.base, rates: currencyRates.rates })
        .from(currencyRates)
        .orderBy(desc(currencyRates.date))
        .limit(1)
        .then((rows) => rows[0] ?? null);
      if (latestRate == null) {
        throw new AppError(
          "No stored currency rates are available",
          "EXCHANGE_RATES_UNAVAILABLE",
          409
        );
      }
      const availableRates = { ...latestRate.rates, [latestRate.base]: 1 };
      if (availableRates[nextMainCurrency] == null) {
        throw new AppError(`Currency not found: ${nextMainCurrency}`, "CURRENCY_NOT_FOUND", 400);
      }
      await recalculateCurrentEntries(tx, input.ledgerId, nextMainCurrency);
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
      .where(and(eq(ledgers.id, input.ledgerId), isNull(ledgers.deletedAt)))
      .returning()
      .then((rows) => rows[0]);
    if (updated == null) throw new ConflictError("Failed to update ledger settings");
    return {
      id: updated.id,
      settings: mapLedgerSettings(updated),
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  });
}

/**
 * Exchange rates only ever get cached as a side effect of a cross-currency
 * conversion, so a ledger whose bills were always recorded in its current
 * main currency can have zero stored rates for those dates. Changing the
 * main currency turns every one of those entries into a cross-currency
 * conversion, and the transactional recalculation
 * (recalculateCurrentEntries) only reads currency_rates — it never fetches.
 * Pre-fetch (and cache) any missing rate here, outside any transaction or
 * ledger lock, so a historically single-currency ledger isn't rejected for
 * dates that are, in fact, fetchable.
 */
async function ensureExchangeRatesForCurrencyChange(
  ledgerId: string,
  nextMainCurrency: string
): Promise<void> {
  const plan = await getRequiredExchangeRateDates(ledgerId);
  if (plan == null) return; // Ledger not found; updateWithCurrencyRecalculation reports that.
  if (plan.currentMainCurrency.trim().toUpperCase() === nextMainCurrency.trim().toUpperCase()) {
    return; // No actual currency change, no new conversions to cover.
  }

  const failedDates: string[] = [];
  await runWithConcurrency(plan.dates, RATE_PREFETCH_CONCURRENCY, async (date) => {
    try {
      await getExchangeRates(date);
    } catch {
      failedDates.push(date);
    }
  });

  if (failedDates.length > 0) {
    throw new AppError(
      `No stored currency rates are available for ${failedDates.length} date(s)`,
      "EXCHANGE_RATES_UNAVAILABLE",
      409,
      { dates: failedDates.sort().slice(0, 5) }
    );
  }
}

export async function updateLedgerSettings(
  ledgerId: string,
  data: UpdateLedgerInput
): Promise<LedgerDto> {
  const nextMainCurrency = data.settings?.mainCurrency;
  if (nextMainCurrency !== undefined) {
    await ensureExchangeRatesForCurrencyChange(ledgerId, nextMainCurrency);
  }

  const updated = await updateWithCurrencyRecalculation({
    ledgerId,
    expectedUpdatedAt: data.expectedUpdatedAt,
    settings: omitUndefinedProperties(data.settings ?? {}),
  });
  if (updated == null) throw new NotFoundError("Ledger");
  return updated;
}
