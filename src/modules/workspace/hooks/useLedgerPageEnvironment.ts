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
import { useCoupleMembers } from "@/modules/auth/hooks/useCoupleMembers";
import type { MemberProfileContract } from "@/application/contracts";

const STALE_TIME = LEDGER.STALE_TIME_MS;
const subscribeToDeviceTimeZone = () => () => {};
const getDeviceTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const getServerTimeZone = () => undefined;

interface UseLedgerPageEnvironmentOptions {
  ledgerId: string;
  /** The signed-in member, whose own time zone the page is dated by. */
  userId: string;
  initialLedger?: LedgerDto | undefined;
  initialCategories?: EntryCategoryWithCount[] | undefined;
  initialMembers?: readonly MemberProfileContract[] | undefined;
  setIsInputOpen: (open: boolean) => void;
}

/**
 * Owns the ledger/categories queries, device-vs-fixed timezone resolution, and the
 * page-level side effects (unsaved-changes beforeunload guard, shell-controller wiring)
 * that every ledger page tab depends on.
 */
export function useLedgerPageEnvironment({
  ledgerId,
  userId,
  initialLedger,
  initialCategories,
  initialMembers,
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
  const { me } = useCoupleMembers({
    ledgerId,
    userId,
    ...(initialMembers !== undefined ? { initialMembers } : {}),
  });
  const fixedTimeZone = me?.timeZone ?? undefined;
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
    categoriesQuery,
    categories,
    categoriesHaveNoData,
    mainCurrency,
    preferredCurrencies,
    effectiveTimeZone,
    dirtyChangeCount,
  };
}
