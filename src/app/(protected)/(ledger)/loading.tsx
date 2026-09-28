import { LedgerRouteFallback } from "./_route-fallback";

/**
 * The routes are dynamic, so without a loading boundary a tap on a tab waits
 * out the server round trip with nothing on screen. With it the router can
 * prefetch the shell down to here and switch at once, the page's skeleton
 * standing in until the route arrives.
 */
export default function LedgerRouteLoading() {
  return <LedgerRouteFallback />;
}
