import { AuthLoginPage } from "@/modules/auth/ui/login-page";
import { runtimeEnv } from "@/lib/env/runtime";
import { isDevAuthBypassEnabled } from "@/modules/auth/dev-auth";
import { getDevPartnerOption } from "@/modules/auth/application/queries/get-dev-partner-option";
import { serverComposition } from "@/application/server-composition-root";

export default async function LoginPage() {
  const devAuthAvailable = isDevAuthBypassEnabled();
  const devPartner = devAuthAvailable
    ? await getDevPartnerOption(serverComposition.userAccounts)
    : null;

  return (
    <AuthLoginPage
      emailAuthEnabled={runtimeEnv.authResendKey != null}
      devAuthAvailable={devAuthAvailable}
      {...(devPartner != null ? { devPartnerLabel: devPartner.label } : {})}
    />
  );
}
