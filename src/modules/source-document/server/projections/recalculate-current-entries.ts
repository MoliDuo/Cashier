import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { SUPPORTED_CURRENCIES } from "@/config/currencies";
import { AppError, ConflictError } from "@/lib/errors";
import { getCurrencyDecimals } from "@/lib/money/currency-precision";
import { currencyRates, ledgerEntries, sourceDocuments } from "@/persistence";
import type { PostgresTransaction } from "@/application/adapters/postgres/transaction-locks";

export async function recalculateCurrentEntries(
  tx: PostgresTransaction,
  ledgerId: string,
  mainCurrency: string,
  entryDate?: string,
  includeUndated = false
): Promise<number> {
  const entries = await tx
    .selectDistinct({
      currency: ledgerEntries.currency,
      entryDate: sourceDocuments.documentDate,
    })
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
        isNull(sourceDocuments.deletedAt),
        ...(entryDate != null
          ? [
              includeUndated
                ? or(
                    eq(sourceDocuments.documentDate, entryDate),
                    isNull(sourceDocuments.documentDate)
                  )
                : eq(sourceDocuments.documentDate, entryDate),
            ]
          : [])
      )
    )
    .where(and(eq(ledgerEntries.ledgerId, ledgerId), isNull(ledgerEntries.deletedAt)));
  if (entries.length === 0) return 0;

  const currencies = new Set(
    entries.map((entry) => (entry.currency ?? mainCurrency).trim().toUpperCase())
  );
  for (const currency of currencies) {
    if (!SUPPORTED_CURRENCIES.includes(currency as (typeof SUPPORTED_CURRENCIES)[number])) {
      throw new AppError(`Currency not found: ${currency}`, "CURRENCY_NOT_FOUND", 400);
    }
  }

  const requiredDates = [
    ...new Set(entries.flatMap((entry) => (entry.entryDate == null ? [] : [entry.entryDate]))),
  ];
  const datedRates =
    requiredDates.length === 0
      ? []
      : await tx.select().from(currencyRates).where(inArray(currencyRates.date, requiredDates));
  const latestRate =
    entries.some((entry) => entry.entryDate == null) || requiredDates.length === 0
      ? await tx
          .select()
          .from(currencyRates)
          .orderBy(desc(currencyRates.date))
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : null;
  const ratesByDate = new Map(datedRates.map((rate) => [rate.date, rate]));
  for (const entry of entries) {
    const sourceCurrency = (entry.currency ?? mainCurrency).trim().toUpperCase();
    if (sourceCurrency === mainCurrency) continue;
    const rate = entry.entryDate == null ? latestRate : ratesByDate.get(entry.entryDate);
    if (rate == null) {
      throw new AppError(
        "No stored currency rates are available",
        "EXCHANGE_RATES_UNAVAILABLE",
        409
      );
    }
    const fullRates = { ...rate.rates, [rate.base]: 1 };
    if (fullRates[sourceCurrency] == null || fullRates[mainCurrency] == null) {
      const missing = fullRates[sourceCurrency] == null ? sourceCurrency : mainCurrency;
      throw new AppError(`Currency not found: ${missing}`, "CURRENCY_NOT_FOUND", 400);
    }
  }

  const decimals = getCurrencyDecimals(mainCurrency);
  const now = new Date();
  const result = await tx.execute(sql`
    WITH candidates AS (
      SELECT
        entry.id,
        entry.source_document_id,
        entry.amount::numeric AS amount,
        COALESCE(entry.currency, ${mainCurrency}) AS source_currency,
        rates.base AS rate_base,
        rates.rates AS rate_values
      FROM ledger_entries AS entry
      INNER JOIN source_documents AS document
        ON document.id = entry.source_document_id
        AND document.ledger_id = ${ledgerId}
        AND document.active_revision_id = entry.source_document_revision_id
        AND document.deleted_at IS NULL
        ${
          entryDate != null
            ? sql`AND (
              ${
                includeUndated
                  ? sql`document.document_date = ${entryDate} OR document.document_date IS NULL`
                  : sql`document.document_date = ${entryDate}`
              }
            )`
            : sql``
        }
      LEFT JOIN currency_rates AS rates
        ON rates.date = COALESCE(
          document.document_date,
          (SELECT MAX(latest.date) FROM currency_rates AS latest)
        )
      WHERE entry.ledger_id = ${ledgerId}
        AND entry.deleted_at IS NULL
    ), ratios AS (
      SELECT
        id,
        source_document_id,
        amount,
        CASE
          WHEN source_currency = ${mainCurrency} THEN 1::numeric
          ELSE (
            CASE WHEN rate_base = ${mainCurrency} THEN 1::numeric
              ELSE (rate_values ->> ${mainCurrency})::numeric END
          ) / (
            CASE WHEN rate_base = source_currency THEN 1::numeric
              ELSE (rate_values ->> source_currency)::numeric END
          )
        END AS ratio
      FROM candidates
    ), converted AS (
      SELECT
        id,
        source_document_id,
        ROUND(amount * ratio, ${decimals}) AS converted_amount,
        ROUND(ratio, 12) AS exchange_rate
      FROM ratios
    ), changed AS (
      SELECT converted.*
      FROM converted
      INNER JOIN ledger_entries AS entry ON entry.id = converted.id
      WHERE entry.converted_amount IS DISTINCT FROM converted.converted_amount
        OR entry.exchange_rate IS DISTINCT FROM converted.exchange_rate
    ), locked_documents AS MATERIALIZED (
      SELECT document.id
      FROM source_documents AS document
      INNER JOIN (
        SELECT DISTINCT source_document_id FROM changed
      ) AS changed_documents ON changed_documents.source_document_id = document.id
      WHERE document.ledger_id = ${ledgerId}
        AND document.deleted_at IS NULL
      ORDER BY document.id
      FOR UPDATE OF document
    ), updated_entries AS (
      UPDATE ledger_entries AS entry
      SET converted_amount = changed.converted_amount,
          exchange_rate = changed.exchange_rate,
          updated_at = ${now}
      FROM changed, locked_documents
      WHERE entry.id = changed.id
        AND entry.ledger_id = ${ledgerId}
        AND entry.deleted_at IS NULL
        AND locked_documents.id = changed.source_document_id
      RETURNING entry.id, changed.source_document_id
    ), updated_documents AS (
      UPDATE source_documents AS document
      SET version = document.version + 1,
          updated_at = ${now}
      FROM (
        SELECT DISTINCT source_document_id FROM updated_entries
      ) AS changed_documents
      WHERE document.id = changed_documents.source_document_id
        AND document.ledger_id = ${ledgerId}
        AND document.deleted_at IS NULL
      RETURNING document.id
    )
    SELECT
      (SELECT COUNT(*) FROM changed)::integer AS changed_count,
      (SELECT COUNT(*) FROM updated_entries)::integer AS updated_count,
      (SELECT COUNT(DISTINCT source_document_id) FROM updated_entries)::integer AS document_count,
      (SELECT COUNT(*) FROM updated_documents)::integer AS updated_document_count
  `);
  const counts = result.rows[0] as
    | {
        changed_count: number;
        updated_count: number;
        document_count: number;
        updated_document_count: number;
      }
    | undefined;
  if (
    counts == null ||
    Number(counts.changed_count) !== Number(counts.updated_count) ||
    Number(counts.document_count) !== Number(counts.updated_document_count)
  ) {
    throw new ConflictError("Ledger entries changed during currency recalculation");
  }
  return Number(counts.updated_count);
}
