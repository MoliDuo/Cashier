import { getLocale } from "next-intl/server";
import { AuthLoginPage } from "@/modules/auth/ui/login-page";
import { runtimeEnv } from "@/lib/env/runtime";
import { isDevAuthBypassEnabled } from "@/modules/auth/dev-auth";
import { redirectToSetupIfPending } from "@/modules/setup/setup-gate";

export default async function LoginPage() {
  await redirectToSetupIfPending(await getLocale());
  return (
    <AuthLoginPage
      emailAuthEnabled={runtimeEnv.authResendKey != null}
      devAuthAvailable={isDevAuthBypassEnabled()}
    />
  );
}
