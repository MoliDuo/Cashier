interface SourceDocumentPageCursor {
  effectiveDate: string;
  createdAt: string;
  id: string;
}

export interface SourceDocumentStreamCursor {
  generation: string;
  filterHash: string;
  page: SourceDocumentPageCursor;
}

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function validTimestamp(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

export function decodeSourceDocumentPageCursor(
  cursor: string | null | undefined
): SourceDocumentPageCursor | null {
  if (cursor == null || cursor === "") return null;
  const [effectiveDate, createdAt, id, ...rest] = cursor.split("|");
  if (
    rest.length > 0 ||
    effectiveDate == null ||
    createdAt == null ||
    id == null ||
    id === "" ||
    !validDate(effectiveDate) ||
    !validTimestamp(createdAt)
  ) {
    return null;
  }
  return { effectiveDate, createdAt, id };
}

export function encodeSourceDocumentPageCursor(cursor: SourceDocumentPageCursor): string {
  return `${cursor.effectiveDate}|${cursor.createdAt}|${cursor.id}`;
}

export function decodeSourceDocumentStreamCursor(
  cursor: string | null | undefined
): SourceDocumentStreamCursor | null {
  if (cursor == null || cursor === "") return null;
  const [version, generation, filterHash, ...pageParts] = cursor.split("|");
  if (
    version !== "v4" ||
    !/^\d+$/.test(generation ?? "") ||
    !/^[a-f0-9]{16}$/.test(filterHash ?? "")
  ) {
    return null;
  }
  const page = decodeSourceDocumentPageCursor(pageParts.join("|"));
  return page == null ? null : { generation: generation!, filterHash: filterHash!, page };
}

export function encodeSourceDocumentStreamCursor(
  generation: string,
  filterHash: string,
  pageCursor: string | null
): string | null {
  if (pageCursor == null) return null;
  const page = decodeSourceDocumentPageCursor(pageCursor);
  if (page == null) return null;
  return `v4|${generation}|${filterHash}|${encodeSourceDocumentPageCursor(page)}`;
}
