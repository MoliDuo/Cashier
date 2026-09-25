import "server-only";
import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
import { ledgerEntries } from "@/persistence";

// SQL for read-time conversion. The arithmetic lives in the convert_amount and
// exchange_ratio database functions; these only name their operands.

interface ConversionOperands {
  amount: SQLWrapper;
  currency: SQLWrapper;
  mainCurrency: SQLWrapper;
  date: SQLWrapper;
}

/** The amount in the main currency at the day's rate; null without a rate. */
export function convertedAmountSql(operands: ConversionOperands): SQL<string | null> {
  return sql<
    string | null
  >`convert_amount(${operands.amount}, ${operands.currency}, ${operands.mainCurrency}, ${operands.date})`;
}

/** Main-currency units per unit of the entry's currency, to 12 places; null without a rate. */
export function exchangeRateSql(operands: Omit<ConversionOperands, "amount">): SQL<string | null> {
  return sql<
    string | null
  >`round(exchange_ratio(${operands.currency}, ${operands.mainCurrency}, ${operands.date}), 12)`;
}

// For a ledger_entries row read without its ledger or document joined.
const entryOperands = () => ({
  amount: ledgerEntries.amount,
  currency: ledgerEntries.currency,
  mainCurrency: sql`(SELECT entry_ledger.main_currency FROM ledgers entry_ledger
    WHERE entry_ledger.id = ${ledgerEntries.ledgerId})`,
  date: sql`(SELECT entry_document.effective_date FROM source_documents entry_document
    WHERE entry_document.ledger_id = ${ledgerEntries.ledgerId}
      AND entry_document.id = ${ledgerEntries.sourceDocumentId})`,
});

/** convertedAmountSql for a ledger_entries row, looking up its ledger and document. */
export function entryConvertedAmountSql(): SQL<string | null> {
  return convertedAmountSql(entryOperands());
}

/** exchangeRateSql for a ledger_entries row, looking up its ledger and document. */
export function entryExchangeRateSql(): SQL<string | null> {
  return exchangeRateSql(entryOperands());
}
