import { AuthLoginPage } from "@/modules/auth/ui/login-page";
import { runtimeEnv } from "@/lib/env/runtime";
import { isDevAuthBypassEnabled } from "@/modules/auth/dev-auth";
import { hasAccount } from "@/modules/auth/server/initial-account";

/** Whether an account exists is read from the database, so nothing is prerendered. */
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  return (
    <AuthLoginPage
      emailAuthEnabled={runtimeEnv.authResendKey != null}
      devAuthAvailable={isDevAuthBypassEnabled()}
      accountMissing={!(await hasAccount())}
    />
  );
}
