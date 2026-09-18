"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { queryKeys } from "@/lib/query-keys";
import type { BookDto } from "@/modules/ledger/contracts";
import {
  archiveBookAction,
  createBookAction,
  deleteBookAction,
  reorderBooksAction,
  restoreBookAction,
  setDefaultBookAction,
  updateBookAction,
  type BookMutationErrorCode,
  type BookMutationResult,
} from "@/modules/ledger/server-actions/books";

/**
 * Book management writes. Every success carries the whole book list, so the
 * cache is written directly and the switcher, the record pickers and 设置 all
 * move together without waiting for a refetch.
 *
 * The archived-inclusive list is what the actions answer with, and it seeds both
 * cache entries: the switcher's live list is that list minus the retired rows,
 * so the two views can never disagree about which books exist.
 */
export function useBookMutations(ledgerId: string) {
  const queryClient = useQueryClient();
  const t = useTranslations("Settings.Books");

  const message = (code: BookMutationErrorCode) => {
    switch (code) {
      case "name_taken":
        return t("nameTaken");
      case "invalid_name":
        return t("invalidName");
      case "has_records":
        return t("hasRecords");
      case "has_credentials":
        return t("hasCredentials");
      case "last_book":
        return t("lastBook");
      case "default_book":
        return t("defaultCannotArchive");
      case "not_found":
        return t("notFound");
      default:
        return t("saveFailed");
    }
  };

  /** Unwraps the action result: a refusal is a toast, not a mutation success. */
  const unwrap = (result: BookMutationResult): BookDto[] => {
    if (!result.ok) {
      toast.error(message(result.code));
      throw new Error(result.code);
    }
    return result.books;
  };

  const writeBooks = (books: BookDto[]) => {
    queryClient.setQueryData(queryKeys.booksIncludingArchived(ledgerId), books);
    queryClient.setQueryData(
      queryKeys.books(ledgerId),
      books.filter((book) => book.archivedAt == null)
    );
  };

  const createBook = useMutation({
    mutationFn: (input: { name: string; timeZone: string | null }) =>
      createBookAction(ledgerId, input),
    onSuccess: (result) => {
      writeBooks(unwrap(result));
    },
  });

  const updateBook = useMutation({
    mutationFn: (input: { bookId: string; name?: string; timeZone?: string | null }) =>
      updateBookAction(ledgerId, input.bookId, {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.timeZone === undefined ? {} : { timeZone: input.timeZone }),
      }),
    onSuccess: (result) => {
      writeBooks(unwrap(result));
    },
  });

  const reorderBooks = useMutation({
    mutationFn: (bookIds: string[]) => reorderBooksAction(ledgerId, bookIds),
    onSuccess: (result) => {
      writeBooks(unwrap(result));
    },
  });

  const setDefaultBook = useMutation({
    mutationFn: (bookId: string) => setDefaultBookAction(ledgerId, bookId),
    onSuccess: (result) => {
      writeBooks(unwrap(result));
    },
  });

  const archiveBook = useMutation({
    mutationFn: (bookId: string) => archiveBookAction(ledgerId, bookId),
    onSuccess: (result) => {
      writeBooks(unwrap(result));
      toast.success(t("archived"));
    },
  });

  const restoreBook = useMutation({
    mutationFn: (bookId: string) => restoreBookAction(ledgerId, bookId),
    onSuccess: (result) => {
      writeBooks(unwrap(result));
      toast.success(t("restored"));
    },
  });

  const deleteBook = useMutation({
    mutationFn: (bookId: string) => deleteBookAction(ledgerId, bookId),
    onSuccess: (result) => {
      writeBooks(unwrap(result));
      toast.success(t("deleted"));
    },
  });

  return {
    createBook,
    updateBook,
    reorderBooks,
    setDefaultBook,
    archiveBook,
    restoreBook,
    deleteBook,
  };
}
