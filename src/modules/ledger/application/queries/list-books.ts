import type { BookContract, BookPort } from "@/application/contracts";
import type { BookDto } from "@/modules/ledger/contracts";

export function toBookDto(book: BookContract): BookDto {
  return {
    id: book.id,
    ledgerId: book.ledgerId,
    name: book.name,
    timeZone: book.timeZone,
    sortOrder: book.sortOrder,
    isDefault: book.isDefault,
  };
}

/**
 * The switcher's list: 总账 is not a row, it is the absence of a selection, so
 * this returns the books only. An empty list means the ledger has no live book,
 * which the setup wizard and the archive rules between them do not allow.
 */
export async function listBooks(
  ledgerId: string,
  books: Pick<BookPort, "list">
): Promise<BookDto[]> {
  return (await books.list(ledgerId)).map(toBookDto);
}
