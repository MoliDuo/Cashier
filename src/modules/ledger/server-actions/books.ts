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
import { listBooksIncludingArchived } from "../server/list-books";
import {
  archiveBook,
  createBook,
  deleteBook,
  reorderBooks,
  restoreBook,
  updateBook,
} from "../server/books";
import { AppError, ValidationError } from "@/lib/errors";
import { logError } from "@/lib/error-handlers";

export type BookMutationErrorCode =
  | "name_taken"
  | "invalid_name"
  | "not_found"
  | "has_records"
  | "has_credentials"
  | "last_book"
  | "invalid_order"
  | "unexpected";
export type BookMutationResult =
  { ok: true; books: BookDto[]; book?: BookDto } | { ok: false; code: BookMutationErrorCode };

/** Whether a validation failure was about the name the reader typed. */
function blamesName(error: ValidationError): boolean {
  const issues = error.details?.issues as { path?: unknown[] }[] | undefined;
  return issues?.some((issue) => issue.path?.[0] === "name") ?? false;
}

/**
 * The expected refusals are returned as codes rather than thrown: a server
 * action's thrown message is not a stable contract, and every one of these is
 * something the 设置 UI has to explain to the reader. The port raises its own
 * `AppError` codes, so the mapping never matches on message text.
 */
function toBookMutationErrorCode(error: unknown): BookMutationErrorCode {
  if (!(error instanceof AppError)) return "unexpected";
  switch (error.code) {
    case "BOOK_NAME_TAKEN":
      return "name_taken";
    case "BOOK_LAST_ACTIVE":
      return "last_book";
    case "BOOK_ORDER_INVALID":
      return "invalid_order";
    case "NOT_FOUND":
      return "not_found";
    case "VALIDATION_ERROR":
      // The contract rejects a bad name before the port runs, and both sides
      // point the issue at the `name` field.
      return error instanceof ValidationError && blamesName(error) ? "invalid_name" : "unexpected";
    default:
      return "unexpected";
  }
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

export const createBookAction = withLedgerAccess(
  (ledgerId: string, data: CreateBookInput): Promise<BookMutationResult> =>
    runBookMutation(async () => {
      const validated = parseCreateBookInput(data);
      const created = await createBook(ledgerId, {
        name: validated.name,
        timeZone: validated.timeZone ?? null,
      });
      return {
        book: created,
        books: await listBooksIncludingArchived(ledgerId),
      };
    })
);

export const updateBookAction = withLedgerAccess(
  (ledgerId: string, bookId: string, data: UpdateBookInput): Promise<BookMutationResult> =>
    runBookMutation(async () => {
      const validatedId = parseBookId(bookId);
      const validated = parseUpdateBookInput(data);
      const updated = await updateBook(ledgerId, validatedId, {
        ...(validated.name === undefined ? {} : { name: validated.name }),
        ...(validated.timeZone === undefined ? {} : { timeZone: validated.timeZone }),
      });
      if (updated == null) throw new AppError("Book not found", "NOT_FOUND", 404);
      return {
        book: updated,
        books: await listBooksIncludingArchived(ledgerId),
      };
    })
);

export const reorderBooksAction = withLedgerAccess(
  (ledgerId: string, bookIds: string[]): Promise<BookMutationResult> =>
    runBookMutation(async () => {
      const validated = parseReorderBooksInput(bookIds);
      await reorderBooks(ledgerId, validated);
      return { books: await listBooksIncludingArchived(ledgerId) };
    })
);

/**
 * Retires a book that still holds records. Refused while an active API key is
 * bound to it, or for the last live book; those come back as codes so 设置 can
 * say which one it is.
 */
export const archiveBookAction = withLedgerAccess(
  async (ledgerId: string, bookId: string): Promise<BookMutationResult> => {
    try {
      const validatedId = parseBookId(bookId);
      const result = await archiveBook(ledgerId, validatedId);
      if (result.status !== "archived") return { ok: false, code: result.status };
      return { ok: true, books: await listBooksIncludingArchived(ledgerId) };
    } catch (error) {
      const code = toBookMutationErrorCode(error);
      if (code === "unexpected") logError("books:archive", error);
      return { ok: false, code };
    }
  }
);

export const restoreBookAction = withLedgerAccess(
  async (ledgerId: string, bookId: string): Promise<BookMutationResult> => {
    try {
      const validatedId = parseBookId(bookId);
      const restored = await restoreBook(ledgerId, validatedId);
      return {
        ok: true,
        book: restored,
        books: await listBooksIncludingArchived(ledgerId),
      };
    } catch (error) {
      const code = toBookMutationErrorCode(error);
      if (code === "unexpected") logError("books:restore", error);
      return { ok: false, code };
    }
  }
);

export const deleteBookAction = withLedgerAccess(
  async (ledgerId: string, bookId: string): Promise<BookMutationResult> => {
    try {
      const validatedId = parseBookId(bookId);
      const result = await deleteBook(ledgerId, validatedId);
      if (result.status !== "deleted") return { ok: false, code: result.status };
      return { ok: true, books: await listBooksIncludingArchived(ledgerId) };
    } catch (error) {
      const code = toBookMutationErrorCode(error);
      if (code === "unexpected") logError("books:delete", error);
      return { ok: false, code };
    }
  }
);
