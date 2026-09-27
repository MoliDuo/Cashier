import { RecordsRoute } from "@/modules/workspace/ui/routes/RecordsRoute";
import { RoutePrefetch, type RouteSearchParams } from "../_route-prefetch";

// Server actions run on the page that calls them, AI parses included.
export const maxDuration = 120;

export default function RecordsPage({ searchParams }: { searchParams: RouteSearchParams }) {
  return (
    <RoutePrefetch tab="records" searchParams={searchParams}>
      <RecordsRoute />
    </RoutePrefetch>
  );
}
