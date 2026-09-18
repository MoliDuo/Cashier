"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { LEDGER } from "@/lib/constants";
import { getBooksAction } from "@/modules/ledger/server-actions/books";
import type { BookDto } from "@/modules/ledger/contracts";

interface UseBooksOptions {
  ledgerId: string;
  /** Hydrated from the page bootstrap, so the switcher paints on the first frame. */
  initialBooks?: readonly BookDto[];
}

/**
 * The ledger's books, in switcher order. The switcher, the record pickers and
 * the 设置 list all read this one query, so a rename or reorder made in 设置 shows
 * everywhere without a reload and a cached page cannot keep showing a stale name.
 */
export function useBooks({ ledgerId, initialBooks }: UseBooksOptions) {
  const booksQuery = useQuery({
    queryKey: queryKeys.books(ledgerId),
    queryFn: () => getBooksAction(ledgerId),
    staleTime: LEDGER.STALE_TIME_MS,
    ...(initialBooks !== undefined ? { initialData: [...initialBooks] } : {}),
  });
  const books = booksQuery.data;
  return {
    books,
    defaultBook: books?.find((book) => book.isDefault) ?? null,
    booksQuery,
  };
}
