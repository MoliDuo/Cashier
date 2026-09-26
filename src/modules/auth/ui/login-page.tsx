"use client";

import Image from "next/image";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLoginFlow } from "../hooks/use-login-flow";
import { EmailStep } from "./email-step";
import { OtpStep } from "./otp-step";
import { useSearchParams } from "next/navigation";
import { textRoleClassName } from "@/components/typography";
import { authCopy } from "@/copy/auth";

export function AuthLoginPage({
  emailAuthEnabled = false,
  devAuthAvailable = false,
  accountMissing = false,
}: {
  emailAuthEnabled?: boolean;
  devAuthAvailable?: boolean;
  accountMissing?: boolean;
}) {
  const searchParams = useSearchParams();
  const flow = useLoginFlow({ isDevAuthAvailable: devAuthAvailable });
  const notice = searchParams.get("notice");
  const noticeMessage =
    notice === "reauth_required"
      ? authCopy.reauthRequiredNotice
      : notice === "credentials_changed"
        ? authCopy.credentialsChangedNotice
        : null;

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4 py-8">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <Image
            src="/icon.png"
            alt=""
            width={48}
            height={48}
            className="mx-auto mb-4 rounded-lg border border-border"
          />
          <h1 className={textRoleClassName("pageTitle")}>
            <span translate="no">Cashier</span>
          </h1>
          <p className={textRoleClassName("bodyMuted", "mt-2")}>{authCopy.productTagline}</p>
        </div>

        <div className="rounded-lg border border-border bg-surface p-6 shadow-none">
          {accountMissing ? (
            <div role="status" className="mb-5 rounded-md bg-surface2 p-3">
              <p className={textRoleClassName("bodyStrong")}>{authCopy.noAccountTitle}</p>
              <p className={textRoleClassName("bodyMuted", "mt-1")}>{authCopy.noAccountDesc}</p>
              <pre className="mt-2 overflow-x-auto text-xs text-text">
                <code translate="no">
                  {"npm run account:create -- --email you@example.com\n"}
                  {"npm run account:enroll -- --email you@example.com"}
                </code>
              </pre>
            </div>
          ) : null}
          {noticeMessage != null ? (
            <p role="status" className="mb-5 rounded-md bg-surface2 p-3 text-sm text-text">
              {noticeMessage}
            </p>
          ) : null}
          {flow.passkeySupported ? (
            <div className="mb-5">
              <Button
                type="button"
                className="min-h-11 w-full"
                disabled={flow.isLoading || flow.resendPending}
                onClick={() => void flow.handlePasskeyLogin()}
              >
                <KeyRound aria-hidden="true" className="size-4" />
                {authCopy.passkeySignIn}
              </Button>
              {emailAuthEnabled ? (
                <div className="mt-5 flex items-center gap-3" aria-hidden="true">
                  <span className="h-px flex-1 bg-border" />
                  <span className={textRoleClassName("meta")}>{authCopy.orDivider}</span>
                  <span className="h-px flex-1 bg-border" />
                </div>
              ) : null}
            </div>
          ) : null}
          {emailAuthEnabled ? (
            <>
              <div className="mb-5">
                <h2 className={textRoleClassName("sectionTitle")}>
                  {flow.step === "email" ? authCopy.emailLoginTitle : authCopy.verifyCode}
                </h2>
                <p className={textRoleClassName("bodyMuted", "mt-1")}>
                  {flow.step === "email"
                    ? authCopy.emailLoginDesc
                    : authCopy.verifyCodeDesc({ email: flow.email })}
                </p>
              </div>
              {flow.step === "email" ? (
                <EmailStep
                  callbackUrl={flow.callbackUrl}
                  email={flow.email}
                  isLoading={flow.isLoading}
                  error={flow.error}
                  onEmailChange={flow.setEmail}
                  onSubmit={flow.handleSendOTP}
                />
              ) : (
                <OtpStep
                  otp={flow.otp}
                  isLoading={flow.isLoading}
                  error={flow.error}
                  expiresAt={flow.expiresAt}
                  canResendAt={flow.canResendAt}
                  resendPending={flow.resendPending}
                  otpExpired={flow.otpExpired}
                  onOtpChange={flow.setOtp}
                  onVerify={flow.handleVerifyOTP}
                  onResend={flow.handleResendOTP}
                  onChangeEmail={flow.handleChangeEmail}
                  onExpired={flow.handleOTPExpired}
                />
              )}
            </>
          ) : (
            <>
              <p className={textRoleClassName("bodyMuted")}>{authCopy.emailAuthNotConfigured}</p>
              {flow.error != null ? (
                <p
                  role="alert"
                  className="mt-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive"
                >
                  {flow.error}
                </p>
              ) : null}
            </>
          )}
        </div>

        {flow.isDevAuthAvailable ? (
          <div className="mt-4 rounded-md border border-dashed border-border bg-surface2/60 p-3 text-center">
            <p className={textRoleClassName("meta")}>{authCopy.devSignInDesc}</p>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => flow.handleDevSignIn()}
                disabled={flow.isLoading}
                className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-surface px-3 text-sm font-medium text-text transition-colors hover:bg-surface2 disabled:opacity-50"
              >
                {authCopy.devSignIn}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
