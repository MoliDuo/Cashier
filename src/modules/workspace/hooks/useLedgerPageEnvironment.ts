"use client";
import { useEffect, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { LEDGER } from "@/lib/constants";
import { runtimeEnv } from "@/lib/env/runtime";
import { getEntryCategoriesAction, getLedgerAction } from "@/lib/queries/ledger-query-client";
import type { EntryCategoryWithCount, LedgerDto } from "@/modules/ledger/contracts";
import { useShellController } from "@/components/providers/shell-controller";
import { useUnsavedChangesStore } from "@/lib/store/unsaved-changes";
import { preloadNewRecordModules } from "@/modules/workspace/ui/NewRecordForms";
import { useBooks } from "@/modules/ledger/hooks/useBooks";
import type { BookDto } from "@/modules/ledger/contracts";
import type { RecordScope } from "@/modules/ledger/filters";
import {
  getDeviceTimeZone as readDeviceTimeZone,
  writeDeviceTimeZoneCookie,
} from "@/lib/time-zone-cookie";

const STALE_TIME = LEDGER.STALE_TIME_MS;
const subscribeToDeviceTimeZone = () => () => {};
const getDeviceTimeZoneSnapshot = () => readDeviceTimeZone() ?? undefined;
const getHydratedSnapshot = () => true;
const getServerSnapshotFalse = () => false;

interface UseLedgerPageEnvironmentOptions {
  ledgerId: string;
  /** The book being viewed, or null for 总账. */
  scope: RecordScope;
  initialLedger?: LedgerDto | undefined;
  initialCategories?: EntryCategoryWithCount[] | undefined;
  initialBooks?: readonly BookDto[] | undefined;
  /**
   * The device zone the server read from this browser's cookie, null when it had
   * none. It is the server's own answer, so the first client render matches the
   * markup the server sent.
   */
  initialDeviceTimeZone: string | null;
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
  initialDeviceTimeZone,
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
  const { books, booksQuery } = useBooks({
    ledgerId,
    ...(initialBooks !== undefined ? { initialBooks } : {}),
  });
  // The viewed book's zone decides; on 总账 — every book at once — the device's
  // own zone does, since no single book owns the view.
  const scopeBook = scope == null ? null : (books?.find((b) => b.id === scope) ?? null);
  const fixedTimeZone =
    scopeBook?.timeZone != null && scopeBook.timeZone !== "" ? scopeBook.timeZone : undefined;
  // Before hydration this is the zone the server rendered with; after it, it is
  // the browser's own, which the effect below writes back as the cookie that
  // dates the next request. Reading it only after hydration is what stops the
  // first client render from disagreeing with the markup it is hydrating.
  const deviceTimeZone =
    useSyncExternalStore(
      subscribeToDeviceTimeZone,
      getDeviceTimeZoneSnapshot,
      () => initialDeviceTimeZone ?? undefined
    ) ?? undefined;
  const isHydrated = useSyncExternalStore(
    subscribeToDeviceTimeZone,
    getHydratedSnapshot,
    getServerSnapshotFalse
  );
  // A viewed book cannot be dated until the list naming it has answered — its own
  // zone may be the answer. A list that failed has answered too, in the sense that
  // the tab must not wait on it for ever: it dates by the device zone, and the
  // failed read keeps the retry it already has. A browser that cannot name a zone
  // is dated by the deployment's, exactly as the server would have; waiting for it
  // would never end.
  const bookScopeResolved = scope == null || books !== undefined || booksQuery.isError;
  const timeZoneReady =
    fixedTimeZone != null || (bookScopeResolved && (deviceTimeZone != null || isHydrated));
  const effectiveTimeZone =
    fixedTimeZone ?? deviceTimeZone ?? (isHydrated ? runtimeEnv.timeZone : undefined);

  // The server prefetches the page and the hovered tab, and it has no device.
  // The zone resolved here is written where a server render can read it, so a
  // book without a zone of its own is dated the same on both sides.
  useEffect(() => {
    if (deviceTimeZone == null) return;
    writeDeviceTimeZoneCookie(deviceTimeZone);
  }, [deviceTimeZone]);

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
    categoriesQuery,
    categories,
    categoriesHaveNoData,
    mainCurrency,
    preferredCurrencies,
    effectiveTimeZone,
    deviceTimeZone,
    timeZoneReady,
  };
}
