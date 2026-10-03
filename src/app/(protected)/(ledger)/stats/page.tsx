import { StatsRoute } from "@/modules/workspace/ui/routes/StatsRoute";
import { RoutePrefetch, type RouteSearchParams } from "../_route-prefetch";

export default function StatsPage({ searchParams }: { searchParams: RouteSearchParams }) {
  return (
    <RoutePrefetch tab="stats" searchParams={searchParams}>
      <StatsRoute />
    </RoutePrefetch>
  );
}
