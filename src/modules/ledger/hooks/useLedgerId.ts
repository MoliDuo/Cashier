"use client";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { fetchLedger } from "@/modules/ledger/queries";

/**
 * The signed-in ledger's id from the shell's cached ledger read, or null
 * before it has one. It only watches the cache: the shell owns the fetch.
 */
export function useLedgerId(): string | null {
  const { data } = useQuery({
    queryKey: queryKeys.ledger(),
    queryFn: () => fetchLedger(),
    enabled: false,
  });
  return data?.id ?? null;
}
