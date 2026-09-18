"use client";
import { useEffect, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { LEDGER } from "@/lib/constants";
import { getLedgerAction } from "@/modules/ledger/server-actions/get";
import { getEntryCategoriesAction } from "@/modules/ledger/server-actions/categories";
import type { EntryCategoryWithCount, LedgerDto } from "@/modules/ledger/contracts";
import { useShellController } from "@/components/providers/shell-controller";
import { useUnsavedChangesStore } from "@/lib/store/unsaved-changes";
import { preloadNewRecordModules } from "@/modules/workspace/ui/NewRecordForms";
import { useBooks } from "@/modules/ledger/hooks/useBooks";
import type { BookDto } from "@/modules/ledger/contracts";
import type { RecordScope } from "@/modules/ledger/filters";

const STALE_TIME = LEDGER.STALE_TIME_MS;
const subscribeToDeviceTimeZone = () => () => {};
const getDeviceTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const getServerTimeZone = () => undefined;

interface UseLedgerPageEnvironmentOptions {
  ledgerId: string;
  /** The book being viewed, or null for 总账. */
  scope: RecordScope;
  initialLedger?: LedgerDto | undefined;
  initialCategories?: EntryCategoryWithCount[] | undefined;
  initialBooks?: readonly BookDto[] | undefined;
  setIsInputOpen: (open: boolean) => void;
}

/**
 * Owns the ledger/categories queries, device-vs-fixed timezone resolution, and the
 * page-level side effects (unsaved-changes beforeunload guard, shell-controller wiring)
 * that every ledger page tab depends on.
 */
export function useLedgerPageEnvironment({
  ledgerId,
  scope,
  initialLedger,
  initialCategories,
  initialBooks,
  setIsInputOpen,
}: UseLedgerPageEnvironmentOptions) {
  const { data: ledger } = useQuery({
    queryKey: queryKeys.ledger(ledgerId),
    queryFn: () => getLedgerAction(ledgerId),
    staleTime: STALE_TIME,
    ...(initialLedger !== undefined ? { initialData: initialLedger } : {}),
  });

  const categoriesQuery = useQuery({
    queryKey: queryKeys.entryCategories(ledgerId),
    queryFn: () => getEntryCategoriesAction(ledgerId),
    staleTime: STALE_TIME,
    ...(initialCategories !== undefined ? { initialData: initialCategories } : {}),
  });
  const categories = categoriesQuery.data ?? [];
  const categoriesHaveNoData = categoriesQuery.data === undefined;

  const mainCurrency = ledger?.settings.mainCurrency ?? "CNY";
  const preferredCurrencies = ledger?.settings.currencies ?? [];
  const { books, defaultBook } = useBooks({
    ledgerId,
    ...(initialBooks !== undefined ? { initialBooks } : {}),
  });
  // The viewed book's zone, or the default book's when reading 总账: a book with
  // no zone of its own means this device decides, exactly as before.
  const scopeBook = scope == null ? defaultBook : (books?.find((b) => b.id === scope) ?? null);
  const fixedTimeZone = scopeBook?.timeZone ?? undefined;
  const deviceTimeZone = useSyncExternalStore(
    subscribeToDeviceTimeZone,
    getDeviceTimeZone,
    getServerTimeZone
  );
  const effectiveTimeZone = fixedTimeZone ?? deviceTimeZone;

  const dirtyChangeCount = useUnsavedChangesStore((state) => state.dirtyKeys.size);

  useEffect(() => {
    if (dirtyChangeCount === 0) return;
    const preventUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventUnload);
    return () => window.removeEventListener("beforeunload", preventUnload);
  }, [dirtyChangeCount]);

  // Wire the real new-record handler into the shell once this component mounts.
  const { registerInputIntent, registerOpenInput } = useShellController();

  useEffect(() => {
    return registerOpenInput(() => setIsInputOpen(true));
  }, [registerOpenInput, setIsInputOpen]);

  useEffect(() => {
    return registerInputIntent(preloadNewRecordModules);
  }, [registerInputIntent]);

  return {
    ledger,
    books: books ?? [],
    defaultBook,
    categoriesQuery,
    categories,
    categoriesHaveNoData,
    mainCurrency,
    preferredCurrencies,
    effectiveTimeZone,
    dirtyChangeCount,
  };
}
