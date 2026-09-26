import { StatsRoute } from "@/modules/workspace/ui/routes/StatsRoute";
import { RoutePrefetch, type RouteSearchParams } from "../_route-prefetch";

// Server actions run on the page that calls them, AI parses included.
export const maxDuration = 120;

export default function StatsPage({ searchParams }: { searchParams: RouteSearchParams }) {
  return (
    <RoutePrefetch tab="stats" searchParams={searchParams}>
      <StatsRoute />
    </RoutePrefetch>
  );
}
