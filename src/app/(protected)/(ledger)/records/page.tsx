import { RecordsRoute } from "@/modules/workspace/ui/routes/RecordsRoute";
import { RoutePrefetch, type RouteSearchParams } from "../_route-prefetch";

export default function RecordsPage({ searchParams }: { searchParams: RouteSearchParams }) {
  return (
    <RoutePrefetch tab="records" searchParams={searchParams}>
      <RecordsRoute />
    </RoutePrefetch>
  );
}
