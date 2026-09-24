import type { SettingsPort } from "@/application/contracts";
import type { FxRateBook } from "@/modules/currency/application/ports";
import { AppError, NotFoundError } from "@/lib/errors";
import type { UpdateLedgerInput } from "@/modules/ledger/contract-schemas";
import type { LedgerDto } from "@/modules/ledger/contracts";
import { omitUndefinedProperties } from "@/lib/validation";
import { runWithConcurrency } from "@/lib/concurrency";

const RATE_PREFETCH_CONCURRENCY = 4;

export async function updateLedger(
  ledgerId: string,
  data: UpdateLedgerInput,
  settings: Pick<SettingsPort, "updateWithCurrencyRecalculation" | "getRequiredExchangeRateDates">,
  exchangeRates: Pick<FxRateBook, "getRates">
): Promise<LedgerDto> {
  const nextMainCurrency = data.settings?.mainCurrency;
  if (nextMainCurrency !== undefined) {
    await ensureExchangeRatesForCurrencyChange(ledgerId, nextMainCurrency, {
      settings,
      exchangeRates,
    });
  }

  const updated = await settings.updateWithCurrencyRecalculation({
    ledgerId,
    expectedUpdatedAt: data.expectedUpdatedAt,
    settings: omitUndefinedProperties(data.settings ?? {}),
  });
  if (updated == null) throw new NotFoundError("Ledger");
  return {
    id: updated.id,
    settings: updated.settings,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
  };
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
  nextMainCurrency: string,
  dependencies: {
    settings: Pick<SettingsPort, "getRequiredExchangeRateDates">;
    exchangeRates: Pick<FxRateBook, "getRates">;
  }
): Promise<void> {
  const plan = await dependencies.settings.getRequiredExchangeRateDates(ledgerId);
  if (plan == null) return; // Ledger not found; updateWithCurrencyRecalculation reports that.
  if (plan.currentMainCurrency.trim().toUpperCase() === nextMainCurrency.trim().toUpperCase()) {
    return; // No actual currency change, no new conversions to cover.
  }

  const failedDates: string[] = [];
  await runWithConcurrency(plan.dates, RATE_PREFETCH_CONCURRENCY, async (date) => {
    try {
      await dependencies.exchangeRates.getRates(date);
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
