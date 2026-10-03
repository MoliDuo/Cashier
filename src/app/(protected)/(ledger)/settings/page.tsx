import { resolveAuthenticatedHome } from "@/modules/workspace/server/resolve-authenticated-home";
import { SettingsRoute } from "@/modules/workspace/ui/routes/SettingsRoute";
import { RoutePrefetch, type RouteSearchParams } from "../_route-prefetch";
import { orSignIn } from "../_sign-in";

export default async function SettingsPage({ searchParams }: { searchParams: RouteSearchParams }) {
  const { email } = await orSignIn(resolveAuthenticatedHome());
  return (
    <RoutePrefetch tab="settings" searchParams={searchParams}>
      <SettingsRoute {...(email != null ? { userEmail: email } : {})} />
    </RoutePrefetch>
  );
}
