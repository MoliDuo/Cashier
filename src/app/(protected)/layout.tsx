import { redirect } from "next/navigation";
import { Providers } from "@/components/providers";
import { resolveAuthenticatedHome } from "@/modules/workspace/server/resolve-authenticated-home";
import { UnauthorizedError } from "@/lib/errors";
import { redirectToSetupIfPending } from "@/modules/setup/setup-gate";

/**
 * Every route under here reads the session and the setup state, so there is
 * nothing to prerender: without this the build tries to render the page and
 * reaches for a database that is not there.
 */
export const dynamic = "force-dynamic";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  // An empty instance has no account to sign in to, so nothing protected is
  // reachable until the wizard has run.
  await redirectToSetupIfPending();
  try {
    await resolveAuthenticatedHome();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      redirect("/login");
    }
    throw error;
  }

  return <Providers>{children}</Providers>;
}
