import { and, eq, lt, or, sql, type SQL } from "drizzle-orm";
import { sourceDocuments } from "@/persistence";
import {
  decodeSourceDocumentPageCursor,
  encodeSourceDocumentPageCursor,
} from "../../stream-cursor";

import type { SourceDocumentListRow } from "./mappers";

export function cursorCondition(cursor: string | null | undefined): SQL<unknown> | null {
  if (cursor == null || cursor === "") return null;
  const decoded = decodeSourceDocumentPageCursor(cursor);
  if (decoded == null) return null;
  const createdAt = new Date(decoded.createdAt);
  return (
    or(
      sql`${sourceDocuments.documentDate} < ${decoded.documentDate}::date`,
      and(
        sql`${sourceDocuments.documentDate} = ${decoded.documentDate}::date`,
        lt(sourceDocuments.createdAt, createdAt)
      ),
      and(
        sql`${sourceDocuments.documentDate} = ${decoded.documentDate}::date`,
        eq(sourceDocuments.createdAt, createdAt),
        sql`${sourceDocuments.id} < ${decoded.id}`
      )
    ) ?? null
  );
}

export function encodeCursor(row: SourceDocumentListRow): string {
  return encodeSourceDocumentPageCursor({
    documentDate: row.documentDate,
    createdAt: row.createdAt.toISOString(),
    id: row.id,
  });
}
