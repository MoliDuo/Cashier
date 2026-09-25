import { pgTable, varchar, timestamp, date, numeric, primaryKey, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * One row per calendar day and currency: units of the currency one euro buys
 * on that day. A day without its own publication carries the latest earlier
 * one, recorded in `source_date`; a row fetched before the day's publication
 * is provisional and replaced once the day is final. Conversions read it
 * through the `convert_amount` SQL function, which answers null for a day
 * without a row rather than falling back to another day's rate.
 */
export const exchangeRates = pgTable(
  "exchange_rates",
  {
    rateDate: date("rate_date", { mode: "string" }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    perEur: numeric("per_eur").notNull(),
    sourceDate: date("source_date", { mode: "string" }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.rateDate, table.currency] }),
    check("ck_exchange_rates_per_eur_positive", sql`${table.perEur} > 0`),
  ]
);
