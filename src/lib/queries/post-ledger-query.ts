import { AppError } from "@/lib/errors";
import { errorKindOf, startOperation } from "@/lib/telemetry/client";

/**
 * The browser side of `/api/ledger-queries`: one POST per read, with the
 * status kept on failure so auth and retry decisions can read it. Each module's
 * `queries.ts` wraps it with the input and result types of its own reads.
 */
export async function postLedgerQuery<T>(query: string, args: readonly unknown[] = []): Promise<T> {
  // Each read is a `$op` named `query.<name>`, with its duration and status.
  const op = startOperation(`query.${query}`);
  let response: Response;
  try {
    response = await fetch("/api/ledger-queries", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, args }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    op.fail(errorKindOf(error));
    throw error;
  }
  if (!response.ok) {
    op.fail(`http_${response.status}`);
    throw new AppError("Ledger query failed", "LEDGER_QUERY_FAILED", response.status);
  }
  op.succeed();
  return response.json() as Promise<T>;
}
