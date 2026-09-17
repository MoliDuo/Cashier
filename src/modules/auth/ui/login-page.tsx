"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { useLoginFlow } from "../hooks/use-login-flow";
import { EmailStep } from "./email-step";
import { OtpStep } from "./otp-step";
import { PasswordStep } from "./password-step";
import { useSearchParams } from "next/navigation";
import { textRoleClassName } from "@/components/typography";

export function AuthLoginPage({
  emailAuthEnabled = false,
  devAuthAvailable = false,
  devPartnerLabel,
}: {
  emailAuthEnabled?: boolean;
  devAuthAvailable?: boolean;
  devPartnerLabel?: string;
}) {
  const t = useTranslations("Auth");
  const searchParams = useSearchParams();
  const flow = useLoginFlow(t, {
    initialMode: emailAuthEnabled ? "otp" : "password",
    isDevAuthAvailable: devAuthAvailable,
  });
  const passwordMode = flow.mode === "password";
  const notice = searchParams.get("notice");
  const noticeMessage =
    notice === "reauth_required"
      ? t("reauthRequiredNotice")
      : notice === "credentials_changed"
        ? t("credentialsChangedNotice")
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
          <p className={textRoleClassName("bodyMuted", "mt-2")}>{t("productTagline")}</p>
        </div>

        <div className="rounded-lg border border-border bg-surface p-6 shadow-none">
          {noticeMessage != null ? (
            <p role="status" className="mb-5 rounded-md bg-surface2 p-3 text-sm text-text">
              {noticeMessage}
            </p>
          ) : null}
          {emailAuthEnabled ? (
            <div className="mb-5 grid grid-cols-2 gap-1 rounded-md bg-surface2 p-1">
              <button
                type="button"
                aria-pressed={passwordMode}
                disabled={flow.isLoading || flow.resendPending}
                onClick={() => flow.setMode("password")}
                className={`flex min-h-11 items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors ${passwordMode ? "bg-surface text-text shadow-sm" : "text-muted-foreground hover:text-text"}`}
              >
                {t("password")}
              </button>
              <button
                type="button"
                aria-pressed={!passwordMode}
                disabled={flow.isLoading || flow.resendPending}
                onClick={() => flow.setMode("otp")}
                className={`flex min-h-11 items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors ${!passwordMode ? "bg-surface text-text shadow-sm" : "text-muted-foreground hover:text-text"}`}
              >
                {t("emailCode")}
              </button>
            </div>
          ) : null}

          <div className="mb-5">
            <h2 className={textRoleClassName("sectionTitle")}>
              {passwordMode
                ? t("passwordLoginTitle")
                : flow.step === "email"
                  ? t("emailLoginTitle")
                  : t("verifyCode")}
            </h2>
            <p className={textRoleClassName("bodyMuted", "mt-1")}>
              {passwordMode
                ? t("passwordLoginDesc")
                : flow.step === "email"
                  ? t("emailLoginDesc")
                  : t("verifyCodeDesc", { email: flow.email })}
            </p>
          </div>

          {passwordMode ? (
            <PasswordStep
              email={flow.email}
              password={flow.password}
              isLoading={flow.isLoading}
              error={flow.error}
              onEmailChange={flow.setEmail}
              onPasswordChange={flow.setPassword}
              onSubmit={flow.handlePasswordLogin}
            />
          ) : flow.step === "email" ? (
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
        </div>

        {flow.isDevAuthAvailable ? (
          <div className="mt-4 rounded-md border border-dashed border-border bg-surface2/60 p-3 text-center">
            <p className={textRoleClassName("meta")}>{t("devSignInDesc")}</p>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => flow.handleDevSignIn("dev")}
                disabled={flow.isLoading}
                className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-surface px-3 text-sm font-medium text-text transition-colors hover:bg-surface2 disabled:opacity-50"
              >
                {t("devSignIn")}
              </button>
              {devPartnerLabel != null ? (
                <button
                  type="button"
                  onClick={() => flow.handleDevSignIn("partner")}
                  disabled={flow.isLoading}
                  className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-surface px-3 text-sm font-medium text-text transition-colors hover:bg-surface2 disabled:opacity-50"
                >
                  {t("devSignInAs", { name: devPartnerLabel })}
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
