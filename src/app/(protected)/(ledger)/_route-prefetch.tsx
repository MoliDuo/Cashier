import { headers } from "next/headers";
import { HydrationBoundary, type DehydratedState } from "@tanstack/react-query";
import { logger } from "@/lib/logger";
import { logIdentifier } from "@/lib/security/log-identifier";
import type { LedgerTab } from "@/lib/ledger-tabs";
import { parsePeriodFromSearchParams } from "@/lib/period-utils";
import { readLedgerFilterParams } from "@/modules/workspace/ledger-url-params";
import { readStatsSearchParams } from "@/modules/workspace/stats-url-params";
import {
  getLedgerRouteBootstrap,
  loadLedgerView,
} from "@/modules/workspace/server/ledger-page-bootstrap";

export type RouteSearchParams = Promise<Record<string, string | string[] | undefined>>;

function toUrlSearchParams(searchParams: Awaited<RouteSearchParams>): URLSearchParams {
  const result = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) value.forEach((item) => result.append(key, item));
    else if (value != null) result.set(key, value);
  }
  return result;
}

/**
 * A route's first screen, fetched on the server for a document request so the
 * HTML arrives filled. A client-side move between routes carries the `rsc`
 * header and skips it: the route renders at once from the browser's cache and
 * fetches what it lacks itself, instead of waiting on a server round trip.
 */
export async function RoutePrefetch({
  tab,
  searchParams,
  children,
}: {
  tab: LedgerTab;
  searchParams: RouteSearchParams;
  children: React.ReactNode;
}) {
  if ((await headers()).get("rsc") != null) return children;

  const view = await loadLedgerView();
  const ledgerDto = view.context.ledgerDto;
  const params = toUrlSearchParams(await searchParams);
  let state: DehydratedState | undefined;
  try {
    state = await getLedgerRouteBootstrap({
      tab,
      ledgerDto,
      scope: view,
      ...(tab === "stream" || tab === "details"
        ? {
            periodParams: parsePeriodFromSearchParams(params),
            advancedFilters: readLedgerFilterParams(params),
          }
        : {}),
      ...(tab === "stats" ? { statsState: readStatsSearchParams(params) } : {}),
    });
  } catch (error) {
    logger.error(
      { error, ledgerSubject: logIdentifier("ledger", ledgerDto.id), tab },
      "Ledger route bootstrap failed; falling back to client queries"
    );
  }

  return <HydrationBoundary state={state}>{children}</HydrationBoundary>;
}
