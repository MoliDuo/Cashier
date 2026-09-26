import { AppError } from "@/lib/errors";

/**
 * The browser side of `/api/ledger-queries`: one POST per read, with the
 * status kept on failure so auth and retry decisions can read it. Each module's
 * `queries.ts` wraps it with the input and result types of its own reads.
 */
export async function postLedgerQuery<T>(query: string, args: readonly unknown[] = []): Promise<T> {
  const response = await fetch("/api/ledger-queries", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, args }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new AppError("Ledger query failed", "LEDGER_QUERY_FAILED", response.status);
  }
  return response.json() as Promise<T>;
}
