import { resolveAuthenticatedHome } from "@/modules/workspace/server/resolve-authenticated-home";
import { SettingsRoute } from "@/modules/workspace/ui/routes/SettingsRoute";
import { RoutePrefetch, type RouteSearchParams } from "../_route-prefetch";
import { orSignIn } from "../_sign-in";

export default async function SettingsPage({ searchParams }: { searchParams: RouteSearchParams }) {
  const { session } = await orSignIn(resolveAuthenticatedHome());
  return (
    <RoutePrefetch tab="settings" searchParams={searchParams}>
      <SettingsRoute {...(session.user?.email != null ? { userEmail: session.user.email } : {})} />
    </RoutePrefetch>
  );
}
