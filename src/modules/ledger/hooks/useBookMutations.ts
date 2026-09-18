"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { queryKeys } from "@/lib/query-keys";
import type { BookDto } from "@/modules/ledger/contracts";
import {
  archiveBookAction,
  createBookAction,
  reorderBooksAction,
  setDefaultBookAction,
  updateBookAction,
  type BookMutationErrorCode,
  type BookMutationResult,
} from "@/modules/ledger/server-actions/books";

/**
 * Book management writes. Every success carries the whole book list, so the
 * cache is written directly and the switcher, the record pickers and 设置 all
 * move together without waiting for a refetch.
 */
export function useBookMutations(ledgerId: string) {
  const queryClient = useQueryClient();
  const t = useTranslations("Settings.Books");
  const booksKey = queryKeys.books(ledgerId);

  const message = (code: BookMutationErrorCode) => {
    switch (code) {
      case "name_taken":
        return t("nameTaken");
      case "has_records":
        return t("hasRecords");
      case "last_book":
        return t("lastBook");
      case "default_book":
        return t("defaultCannotArchive");
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

  const createBook = useMutation({
    mutationFn: (input: { name: string; timeZone: string | null }) =>
      createBookAction(ledgerId, input),
    onSuccess: (result) => {
      const books = unwrap(result);
      queryClient.setQueryData(booksKey, books);
    },
  });

  const updateBook = useMutation({
    mutationFn: (input: { bookId: string; name?: string; timeZone?: string | null }) =>
      updateBookAction(ledgerId, input.bookId, {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.timeZone === undefined ? {} : { timeZone: input.timeZone }),
      }),
    onSuccess: (result) => {
      queryClient.setQueryData(booksKey, unwrap(result));
    },
  });

  const reorderBooks = useMutation({
    mutationFn: (bookIds: string[]) => reorderBooksAction(ledgerId, bookIds),
    onSuccess: (result) => {
      queryClient.setQueryData(booksKey, unwrap(result));
    },
  });

  const setDefaultBook = useMutation({
    mutationFn: (bookId: string) => setDefaultBookAction(ledgerId, bookId),
    onSuccess: (result) => {
      queryClient.setQueryData(booksKey, unwrap(result));
    },
  });

  const archiveBook = useMutation({
    mutationFn: (bookId: string) => archiveBookAction(ledgerId, bookId),
    onSuccess: (result) => {
      queryClient.setQueryData(booksKey, unwrap(result));
      toast.success(t("archived"));
    },
  });

  return { createBook, updateBook, reorderBooks, setDefaultBook, archiveBook };
}
