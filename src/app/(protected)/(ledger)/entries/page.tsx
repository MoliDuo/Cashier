import { EntriesRoute } from "@/modules/workspace/ui/routes/EntriesRoute";
import { RoutePrefetch, type RouteSearchParams } from "../_route-prefetch";

// Server actions run on the page that calls them, AI parses included.
export const maxDuration = 120;

export default function EntriesPage({ searchParams }: { searchParams: RouteSearchParams }) {
  return (
    <RoutePrefetch tab="entries" searchParams={searchParams}>
      <EntriesRoute />
    </RoutePrefetch>
  );
}
