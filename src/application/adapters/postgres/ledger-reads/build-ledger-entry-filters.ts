import { createHash } from "node:crypto";
import { eq, isNull, sql, type SQL } from "drizzle-orm";
import { ValidationError } from "@/lib/errors";
import { forLedger } from "@/lib/db/scoped-query";
import { escapedLikeContains } from "@/lib/db/like-pattern";
import { ledgerEntries } from "@/persistence";
import {
  buildLedgerEntrySourceDocumentDateCondition,
  buildLedgerEntryVisibilityCondition,
} from "./ledger-entry-visibility";
import type { LedgerEntryFilterParams } from "@/modules/ledger/filters";
import { serializeLedgerQuery } from "@/modules/ledger/ledger-query";
import { z } from "zod";
import { dateStringSchema, UUID_REGEX } from "@/lib/validation";

// PostgreSQL query construction remains private to the adapter.

export type { LedgerEntryFilterParams } from "@/modules/ledger/filters";

/**
 * Entry-value filters (category, currency, amount range, search).
 *
 * These conditions reference `ledger_entries` columns and may be reused by
 * any query whose FROM item is the plain `ledger_entries` table. The
 * visibility and date-range conditions are owned by the callers that join
 * `source_documents` under the conventional `documents` alias.
 */
export function buildLedgerEntryValueConditions(filters: LedgerEntryFilterParams): SQL<unknown>[] {
  const conditions: SQL<unknown>[] = [];

  if (filters.uncategorizedOnly) {
    conditions.push(isNull(ledgerEntries.categoryId));
  } else if (filters.categoryId != null && filters.categoryId !== "") {
    conditions.push(eq(ledgerEntries.categoryId, filters.categoryId));
  }

  if (filters.currency != null && filters.currency !== "") {
    conditions.push(eq(ledgerEntries.currency, filters.currency));
  }

  if (filters.minAmount !== undefined && filters.minAmount !== null) {
    conditions.push(
      sql`${ledgerEntries.convertedAmount} IS NOT NULL
        AND ${ledgerEntries.convertedAmount} >= ${filters.minAmount}`
    );
  }

  if (filters.maxAmount !== undefined && filters.maxAmount !== null) {
    conditions.push(
      sql`${ledgerEntries.convertedAmount} IS NOT NULL
        AND ${ledgerEntries.convertedAmount} <= ${filters.maxAmount}`
    );
  }

  if (filters.search != null && filters.search !== "") {
    const literalPattern = escapedLikeContains(filters.search);
    conditions.push(
      sql`lower(${ledgerEntries.itemName} || ' ' || COALESCE(${ledgerEntries.description}, ''))
        LIKE ${literalPattern}`
    );
  }

  return conditions;
}

/**
 * Accounting-date range conditions over the generated `effective_date`
 * column. Callers must join `source_documents` under the `documents` alias.
 */
export function buildLedgerEntryEffectiveDateConditions(
  filters: LedgerEntryFilterParams
): SQL<unknown>[] {
  const conditions: SQL<unknown>[] = [];
  if (filters.startDate != null && filters.startDate !== "") {
    conditions.push(sql`documents.effective_date >= ${filters.startDate}::date`);
  }
  if (filters.endDate != null && filters.endDate !== "") {
    conditions.push(sql`documents.effective_date <= ${filters.endDate}::date`);
  }
  return conditions;
}

export function buildLedgerEntryFilterConditions(
  ledgerId: string,
  filters: LedgerEntryFilterParams
): SQL<unknown>[] {
  const q = forLedger(ledgerEntries, ledgerId);
  const conditions: SQL<unknown>[] = [];
  if (q.whereActive != null) {
    conditions.push(q.whereActive);
  }

  const sourceDocumentDateRange: { startDate?: string | null; endDate?: string | null } = {};
  if (filters.startDate !== undefined) {
    sourceDocumentDateRange.startDate = filters.startDate;
  }
  if (filters.endDate !== undefined) {
    sourceDocumentDateRange.endDate = filters.endDate;
  }

  const sourceDocumentDateCondition = buildLedgerEntrySourceDocumentDateCondition(
    ledgerId,
    sourceDocumentDateRange
  );
  if (sourceDocumentDateCondition != null) {
    conditions.push(sourceDocumentDateCondition);
  } else {
    conditions.push(buildLedgerEntryVisibilityCondition(ledgerId));
  }

  return [...conditions, ...buildLedgerEntryValueConditions(filters)];
}

function queryFingerprint(ledgerId: string, filters: LedgerEntryFilterParams): string {
  return createHash("sha256")
    .update(`${ledgerId}\0${serializeLedgerQuery(filters)}`)
    .digest("base64url")
    .slice(0, 16);
}

interface LedgerEntryCursor {
  effectiveDate: string;
  documentCreatedAt: string;
  documentId: string;
  position: number;
  entryId: string;
  fingerprint: string;
}

export function encodeLedgerEntryCursor(
  value: Omit<LedgerEntryCursor, "fingerprint">,
  ledgerId: string,
  filters: LedgerEntryFilterParams
): string {
  return Buffer.from(
    JSON.stringify({ ...value, fingerprint: queryFingerprint(ledgerId, filters) })
  ).toString("base64url");
}

const ledgerEntryCursorSchema = z
  .object({
    effectiveDate: dateStringSchema,
    documentCreatedAt: z.string().datetime({ offset: true }),
    documentId: z.string().regex(UUID_REGEX),
    position: z.number().int().nonnegative(),
    entryId: z.string().regex(UUID_REGEX),
    fingerprint: z.string().regex(/^[A-Za-z0-9_-]{16}$/),
  })
  .strict();

export interface LedgerEntryCursorColumns {
  effectiveDate: SQL;
  documentCreatedAt: SQL;
  documentId: SQL;
  position: SQL;
  entryId: SQL;
}

// Defaults reference the `visible_entries` CTE projection used by
// listLedgerEntryPage. Callers that place the predicate inside the CTE body
// must pass the underlying qualified columns instead.
const cursorColumns = (): LedgerEntryCursorColumns => ({
  effectiveDate: sql`effective_date`,
  documentCreatedAt: sql`document_created_at`,
  documentId: sql`document_id`,
  position: sql`position`,
  entryId: sql`id`,
});

export function buildLedgerEntryCursorCondition(
  cursor: string | null | undefined,
  ledgerId: string,
  filters: LedgerEntryFilterParams,
  columns: LedgerEntryCursorColumns = cursorColumns()
): SQL<unknown> | null {
  if (cursor == null || cursor === "") {
    return null;
  }
  if (cursor.length > 1024) {
    throw new ValidationError("Invalid ledger entry cursor");
  }

  let value: LedgerEntryCursor;
  try {
    value = ledgerEntryCursorSchema.parse(
      JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))
    );
  } catch {
    throw new ValidationError("Invalid ledger entry cursor");
  }
  if (value.fingerprint !== queryFingerprint(ledgerId, filters)) {
    throw new ValidationError("Ledger entry cursor does not match the query");
  }

  return sql`(
    ${columns.effectiveDate} < ${value.effectiveDate}
    OR (${columns.effectiveDate} = ${value.effectiveDate}
      AND ${columns.documentCreatedAt} < ${new Date(value.documentCreatedAt)})
    OR (${columns.effectiveDate} = ${value.effectiveDate}
      AND ${columns.documentCreatedAt} = ${new Date(value.documentCreatedAt)}
      AND ${columns.documentId} < ${value.documentId})
    OR (${columns.effectiveDate} = ${value.effectiveDate}
      AND ${columns.documentCreatedAt} = ${new Date(value.documentCreatedAt)}
      AND ${columns.documentId} = ${value.documentId}
      AND ${columns.position} > ${value.position})
    OR (${columns.effectiveDate} = ${value.effectiveDate}
      AND ${columns.documentCreatedAt} = ${new Date(value.documentCreatedAt)}
      AND ${columns.documentId} = ${value.documentId}
      AND ${columns.position} = ${value.position}
      AND ${columns.entryId} > ${value.entryId})
  )`;
}
