import { EntriesRoute } from "@/modules/workspace/ui/routes/EntriesRoute";
import { RoutePrefetch, type RouteSearchParams } from "../_route-prefetch";

export default function EntriesPage({ searchParams }: { searchParams: RouteSearchParams }) {
  return (
    <RoutePrefetch tab="entries" searchParams={searchParams}>
      <EntriesRoute />
    </RoutePrefetch>
  );
}
