import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AuthLoginPage } from "@/modules/auth/ui/login-page";
import { authCopy, type LoginMessageKey } from "@/copy/auth";
import { SIGNED_OUT_COOKIE_NAME } from "@/modules/auth/constants";
import { isDevAuthBypassEnabled } from "@/modules/auth/dev-auth";
import { sanitizeCallbackPath } from "@/modules/auth/domain/callback-path";
import { hasAccount } from "@/modules/auth/server/initial-account";

/** Whether an account exists is read from the database, so nothing is prerendered. */
export const dynamic = "force-dynamic";

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isMessageKey(value: string | undefined): value is LoginMessageKey {
  return value != null && Object.hasOwn(authCopy.messages, value);
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const callbackUrl = sanitizeCallbackPath(first(params.callbackUrl));
  const justSignedOut = (await cookies()).has(SIGNED_OUT_COOKIE_NAME);
  const messageKey =
    [first(params.error), first(params.notice)].find(isMessageKey) ??
    (justSignedOut ? "signed_out" : null);
  const devAuthAvailable = isDevAuthBypassEnabled();
  const accountMissing = !(await hasAccount());

  // Someone who just left, or was turned away, is not sent straight back to the
  // provider: it would sign them in again, or loop on the same refusal.
  if (messageKey == null && !devAuthAvailable && !accountMissing) {
    redirect(`/api/auth/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }

  return (
    <AuthLoginPage
      messageKey={messageKey}
      callbackUrl={callbackUrl}
      devAuthAvailable={devAuthAvailable}
      accountMissing={accountMissing}
    />
  );
}
