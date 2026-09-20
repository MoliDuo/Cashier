import { withLedgerAccess } from "../access";
import type { BookDto } from "@/modules/ledger/contracts";
import { parseBookId } from "@/modules/ledger/contract-schemas";
import { listBooks, toBookDto } from "@/modules/ledger/application/queries/list-books";
import { serverComposition } from "@/application/server-composition-root";

/** 设置 shows archived books too, and so does every write that answers with the list. */
export function listBooksIncludingArchived(ledgerId: string): Promise<BookDto[]> {
  return listBooks(ledgerId, serverComposition.books, { includeArchived: true });
}

/** The switcher's books, in order. The caller has already been authorized. */
export const getBooksAction = withLedgerAccess(async (ledgerId: string): Promise<BookDto[]> =>
  listBooks(ledgerId, serverComposition.books)
);

/**
 * The same list plus the archived rows: 设置 and the detail page have to show a
 * retired book, while the switcher and the pickers must not.
 */
export const getBooksIncludingArchivedAction = withLedgerAccess(
  async (ledgerId: string): Promise<BookDto[]> => listBooksIncludingArchived(ledgerId)
);

/**
 * One book by id, archived ones included. The detail page uses this to name a
 * record's book when that book has been retired since the record was filed.
 */
export const getBookAction = withLedgerAccess(
  async (ledgerId: string, bookId: unknown): Promise<BookDto | null> => {
    const validatedId = parseBookId(bookId);
    const book = await serverComposition.books.getIncludingArchived(ledgerId, validatedId);
    return book == null ? null : toBookDto(book);
  }
);
