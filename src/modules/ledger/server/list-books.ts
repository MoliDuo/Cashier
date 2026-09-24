import { withLedgerAccess } from "../access";
import type { BookDto } from "@/modules/ledger/contracts";
import { parseBookId } from "@/modules/ledger/contract-schemas";
import { getBookIncludingArchived, listBooks } from "./books";

/** 设置 shows archived books too, and so does every write that answers with the list. */
export function listBooksIncludingArchived(ledgerId: string): Promise<BookDto[]> {
  return listBooks(ledgerId, { includeArchived: true });
}

/**
 * The switcher's books, in order. 总账 is not a row, it is the absence of a
 * selection, so this returns the books only.
 */
export const getBooksAction = withLedgerAccess(async (ledgerId: string): Promise<BookDto[]> =>
  listBooks(ledgerId)
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
  async (ledgerId: string, bookId: unknown): Promise<BookDto | null> =>
    getBookIncludingArchived(ledgerId, parseBookId(bookId))
);
