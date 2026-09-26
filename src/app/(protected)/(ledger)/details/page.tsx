import { DetailsRoute } from "@/modules/workspace/ui/routes/DetailsRoute";
import { RoutePrefetch, type RouteSearchParams } from "../_route-prefetch";

// Server actions run on the page that calls them, AI parses included.
export const maxDuration = 120;

export default function DetailsPage({ searchParams }: { searchParams: RouteSearchParams }) {
  return (
    <RoutePrefetch tab="details" searchParams={searchParams}>
      <DetailsRoute />
    </RoutePrefetch>
  );
}
