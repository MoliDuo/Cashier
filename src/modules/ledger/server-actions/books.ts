"use server";

import { withLedgerAccess } from "../access";
import type { BookDto } from "@/modules/ledger/contracts";
import {
  parseBookId,
  parseCreateBookInput,
  parseReorderBooksInput,
  parseUpdateBookInput,
  type CreateBookInput,
  type UpdateBookInput,
} from "@/modules/ledger/contract-schemas";
import { listBooks, toBookDto } from "@/modules/ledger/application/queries/list-books";
import { serverComposition } from "@/application/server-composition-root";
import { AppError } from "@/lib/errors";
import { logError } from "@/lib/error-handlers";

export type BookMutationErrorCode =
  | "name_taken"
  | "not_found"
  | "has_records"
  | "last_book"
  | "default_book"
  | "invalid_order"
  | "unexpected";
export type BookMutationResult =
  { ok: true; books: BookDto[]; book?: BookDto } | { ok: false; code: BookMutationErrorCode };

/**
 * The expected refusals are returned as codes rather than thrown: a server
 * action's thrown message is not a stable contract, and every one of these is
 * something the 设置 UI has to explain to the reader.
 */
function toBookMutationErrorCode(error: unknown): BookMutationErrorCode {
  if (!(error instanceof AppError)) return "unexpected";
  if (error.code === "CONFLICT") return "name_taken";
  if (error.code === "NOT_FOUND") return "not_found";
  if (error.code !== "VALIDATION_ERROR") return "unexpected";
  if (error.message.includes("last active book")) return "last_book";
  if (error.message.includes("default book")) return "default_book";
  if (error.message.includes("Reorder")) return "invalid_order";
  return "unexpected";
}

async function runBookMutation(
  mutate: () => Promise<{ books: BookDto[]; book?: BookDto }>
): Promise<BookMutationResult> {
  try {
    return { ok: true, ...(await mutate()) };
  } catch (error) {
    const code = toBookMutationErrorCode(error);
    if (code === "unexpected") logError("books:mutate", error);
    return { ok: false, code };
  }
}

/** The switcher's books, in order. The caller has already been authorized. */
export const getBooksAction = withLedgerAccess(async (ledgerId: string): Promise<BookDto[]> =>
  listBooks(ledgerId, serverComposition.books)
);

export const createBookAction = withLedgerAccess(
  (ledgerId: string, data: CreateBookInput): Promise<BookMutationResult> =>
    runBookMutation(async () => {
      const validated = parseCreateBookInput(data);
      const created = await serverComposition.books.create(ledgerId, {
        name: validated.name,
        timeZone: validated.timeZone ?? null,
      });
      return {
        book: toBookDto(created),
        books: await listBooks(ledgerId, serverComposition.books),
      };
    })
);

export const updateBookAction = withLedgerAccess(
  (ledgerId: string, bookId: string, data: UpdateBookInput): Promise<BookMutationResult> =>
    runBookMutation(async () => {
      const validatedId = parseBookId(bookId);
      const validated = parseUpdateBookInput(data);
      const updated = await serverComposition.books.update(ledgerId, validatedId, {
        ...(validated.name === undefined ? {} : { name: validated.name }),
        ...(validated.timeZone === undefined ? {} : { timeZone: validated.timeZone }),
      });
      if (updated == null) throw new AppError("Book not found", "NOT_FOUND", 404);
      return {
        book: toBookDto(updated),
        books: await listBooks(ledgerId, serverComposition.books),
      };
    })
);

export const reorderBooksAction = withLedgerAccess(
  (ledgerId: string, bookIds: string[]): Promise<BookMutationResult> =>
    runBookMutation(async () => {
      const validated = parseReorderBooksInput(bookIds);
      await serverComposition.books.reorder(ledgerId, validated);
      return { books: await listBooks(ledgerId, serverComposition.books) };
    })
);

export const setDefaultBookAction = withLedgerAccess(
  (ledgerId: string, bookId: string): Promise<BookMutationResult> =>
    runBookMutation(async () => {
      const validatedId = parseBookId(bookId);
      await serverComposition.books.setDefault(ledgerId, validatedId);
      return { books: await listBooks(ledgerId, serverComposition.books) };
    })
);

export const archiveBookAction = withLedgerAccess(
  async (ledgerId: string, bookId: string): Promise<BookMutationResult> => {
    try {
      const validatedId = parseBookId(bookId);
      const result = await serverComposition.books.archive(ledgerId, validatedId);
      if (result !== "archived") return { ok: false, code: result };
      return { ok: true, books: await listBooks(ledgerId, serverComposition.books) };
    } catch (error) {
      const code = toBookMutationErrorCode(error);
      if (code === "unexpected") logError("books:archive", error);
      return { ok: false, code };
    }
  }
);
