import Decimal from "decimal.js";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { GetEnhancedStatsInput } from "@/modules/stats/contract-schemas";
import {
  buildEnhancedStatsDto,
  type EnhancedStatsBucket,
} from "@/modules/stats/application/build-enhanced-stats";
import type { EnhancedStatsDto } from "@/modules/stats/contracts";

interface AggregatedRow {
  period: "current" | "previous";
  effectiveDate: string | null;
  currency: string | null;
  categoryId: string | null;
  categoryName: string | null;
  categoryIcon: string | null;
  totalAmount: string | null;
  entryCount: number;
  mainCurrency: string;
  unconvertedCount: number;
}

async function fetchAggregatedRows(
  ledgerId: string,
  current: { from: string; to: string },
  previous: { from: string; to: string },
  attributedUserId?: string
): Promise<AggregatedRow[]> {
  const result = await db.execute<AggregatedRow & Record<string, unknown>>(sql`
    WITH ranges(period, from_date, to_date) AS (
      VALUES
        ('current'::text, ${current.from}::date, ${current.to}::date),
        ('previous'::text, ${previous.from}::date, ${previous.to}::date)
    )
    SELECT ranges.period, documents.effective_date AS "effectiveDate",
      entries.currency, entries.category_id AS "categoryId",
      categories.name AS "categoryName", categories.icon AS "categoryIcon",
      sum(entries.converted_amount)::text AS "totalAmount",
      count(*) FILTER (WHERE entries.converted_amount IS NOT NULL)::int AS "entryCount",
      ledgers.main_currency AS "mainCurrency",
      count(*) FILTER (WHERE entries.converted_amount IS NULL)::int AS "unconvertedCount"
    FROM ranges
    JOIN source_documents documents
      ON documents.ledger_id = ${ledgerId}
      AND documents.effective_date BETWEEN ranges.from_date AND ranges.to_date
      AND documents.deleted_at IS NULL
      ${attributedUserId == null ? sql`` : sql`AND documents.attributed_user_id = ${attributedUserId}`}
    JOIN ledger_entries entries
      ON entries.ledger_id = documents.ledger_id
      AND entries.source_document_id = documents.id
      AND entries.source_document_revision_id = documents.active_revision_id
      AND entries.deleted_at IS NULL
    JOIN ledgers ON ledgers.id = documents.ledger_id AND ledgers.deleted_at IS NULL
    LEFT JOIN entry_categories categories
      ON categories.id = entries.category_id
      AND categories.ledger_id = entries.ledger_id
      AND categories.deleted_at IS NULL
    GROUP BY ranges.period, documents.effective_date, entries.currency, entries.category_id,
      categories.name, categories.icon, ledgers.main_currency
    UNION ALL
    SELECT 'current', NULL, NULL, NULL, NULL, NULL, NULL, 0, main_currency, 0
    FROM ledgers WHERE id = ${ledgerId} AND deleted_at IS NULL
  `);
  return result.rows.map((row) => ({
    ...row,
    entryCount: Number(row.entryCount),
    unconvertedCount: Number(row.unconvertedCount),
  }));
}

function emptyBucket(): EnhancedStatsBucket {
  return {
    total: new Decimal(0),
    categories: new Map(),
    days: new Map(),
  };
}

function addRowToBucket(
  bucket: EnhancedStatsBucket,
  row: AggregatedRow,
  mainCurrency: string
): void {
  if (row.entryCount === 0 || row.totalAmount == null) return;
  const converted = new Decimal(row.totalAmount);
  bucket.total = bucket.total.plus(converted);

  const categoryKey = row.categoryId ?? "uncategorized";
  const category = bucket.categories.get(categoryKey) ?? {
    id: row.categoryId,
    name: row.categoryName ?? "Uncategorized",
    icon: row.categoryIcon ?? null,
    total: new Decimal(0),
    count: 0,
  };
  category.total = category.total.plus(converted);
  category.count += row.entryCount;
  bucket.categories.set(categoryKey, category);

  const date = row.effectiveDate ?? "";
  if (date !== "") {
    const day = bucket.days.get(date) ?? {
      total: new Decimal(0),
      count: 0,
      currencies: new Set<string>(),
    };
    day.total = day.total.plus(converted);
    day.count += row.entryCount;
    day.currencies.add(row.currency ?? mainCurrency);
    bucket.days.set(date, day);
  }
}

export async function getEnhancedStatsQuery({
  ledgerId,
  queryRange,
  compareRange,
  comparisonMode,
  attributedUserId,
}: GetEnhancedStatsInput): Promise<EnhancedStatsDto> {
  const rows = await fetchAggregatedRows(ledgerId, queryRange, compareRange, attributedUserId);
  const mainCurrency = rows[0]?.mainCurrency ?? "CNY";
  const current = emptyBucket();
  const previous = emptyBucket();
  let unconvertedCount = 0;
  for (const row of rows) {
    if (row.period === "current") {
      unconvertedCount += row.unconvertedCount;
      addRowToBucket(current, row, mainCurrency);
    } else {
      addRowToBucket(previous, row, mainCurrency);
    }
  }
  if (unconvertedCount > 0) {
    logger.warn(
      { unconvertedCount, operation: "enhanced_stats" },
      "Entries missing exchange rates were excluded from main-currency statistics"
    );
  }
  return buildEnhancedStatsDto({
    mainCurrency,
    unconvertedCount,
    current,
    previous,
    queryRange,
    compareRange,
    comparisonMode,
  });
}
