/**
 * The items of an infinite list's pages, each once and in the order first
 * read. A page boundary can shift between two reads, so the same item may
 * arrive on two pages; the first copy keeps its place.
 */
export function uniquePagedItems<T extends { id: string }>(
  pages: readonly { items: readonly T[] }[] | undefined
): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const page of pages ?? []) {
    for (const item of page.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      result.push(item);
    }
  }
  return result;
}
