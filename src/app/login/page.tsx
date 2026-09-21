import { AuthLoginPage } from "@/modules/auth/ui/login-page";
import { runtimeEnv } from "@/lib/env/runtime";
import { isDevAuthBypassEnabled } from "@/modules/auth/dev-auth";
import { redirectToSetupIfPending } from "@/modules/setup/setup-gate";

/** The setup gate reads the database on every render, so nothing is prerendered. */
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  await redirectToSetupIfPending();
  return (
    <AuthLoginPage
      emailAuthEnabled={runtimeEnv.authResendKey != null}
      devAuthAvailable={isDevAuthBypassEnabled()}
    />
  );
}
