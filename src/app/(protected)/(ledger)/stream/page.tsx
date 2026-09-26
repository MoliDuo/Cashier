import { StreamRoute } from "@/modules/workspace/ui/routes/StreamRoute";
import { RoutePrefetch, type RouteSearchParams } from "../_route-prefetch";

// Server actions run on the page that calls them, AI parses included.
export const maxDuration = 120;

export default function StreamPage({ searchParams }: { searchParams: RouteSearchParams }) {
  return (
    <RoutePrefetch tab="stream" searchParams={searchParams}>
      <StreamRoute />
    </RoutePrefetch>
  );
}
