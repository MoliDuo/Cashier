import { and, desc, eq, isNull, or } from "drizzle-orm";
import type { SettingsPort } from "@/application/contracts";
import { db } from "@/lib/db";
import { AppError, ConflictError, ValidationError } from "@/lib/errors";
import { currencyRates, ledgerEntries, ledgers, sourceDocuments } from "@/persistence";
import { SUPPORTED_CURRENCIES } from "@/config/currencies";

import { recalculateCurrentEntries } from "../source-document-aggregate/recalculate-current-entries";
import { postgresLedgerAdapter } from "./ledger";
import { getCoupleConfig } from "@/lib/couple-config";
import { mapLedgerSettings, settingsColumns } from "./shared";

export const postgresSettingsAdapter: SettingsPort = {
  async get(ledgerId) {
    const ledger = await db.query.ledgers.findFirst({
      where: and(eq(ledgers.id, ledgerId), isNull(ledgers.deletedAt)),
      columns: {
        aiLanguage: true,
        preferredCurrencies: true,
        mainCurrency: true,
        collapseEntriesDefault: true,
        aiCustomPrompt: true,
        timeZone: true,
      },
    });
    return ledger == null ? null : mapLedgerSettings(ledger);
  },

  async getRequiredExchangeRateDates(ledgerId, userId) {
    const couple = getCoupleConfig();
    if (couple == null || !(await postgresLedgerAdapter.isOwnedByUser(ledgerId, userId)))
      return null;
    const ledger = await db.query.ledgers.findFirst({
      where: and(
        eq(ledgers.id, ledgerId),
        eq(ledgers.userId, couple.ownerId),
        isNull(ledgers.deletedAt)
      ),
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
  },

  async updateWithCurrencyRecalculation(input) {
    const couple = getCoupleConfig();
    if (
      couple == null ||
      !(await postgresLedgerAdapter.isOwnedByUser(input.ledgerId, input.userId))
    )
      return null;
    return db.transaction(async (tx) => {
      // Lock the ledger row to serialise with concurrent first-entry creation.
      // This prevents a main-currency change from interleaving with activateRevision / createManual.
      const ledger = await tx
        .select()
        .from(ledgers)
        .where(
          and(
            eq(ledgers.id, input.ledgerId),
            eq(ledgers.userId, couple.ownerId),
            isNull(ledgers.deletedAt)
          )
        )
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
      if (
        !SUPPORTED_CURRENCIES.includes(nextMainCurrency as (typeof SUPPORTED_CURRENCIES)[number])
      ) {
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
        .where(and(eq(ledgers.id, input.ledgerId), eq(ledgers.userId, couple.ownerId)))
        .returning()
        .then((rows) => rows[0]);
      if (updated == null) throw new ConflictError("Failed to update ledger settings");
      return {
        id: updated.id,
        userId: updated.userId,
        settings: mapLedgerSettings(updated),
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      };
    });
  },
};
