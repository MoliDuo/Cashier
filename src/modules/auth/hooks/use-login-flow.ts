"use client";

import { useState } from "react";
import { signIn, type SignInResponse } from "next-auth/react";
import { useLocale } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useRouter } from "@/i18n/routing";
import { AUTH_ERROR_CODES } from "@/modules/auth/errors";
import { sendOTPAction } from "@/modules/auth/server-actions/send-otp";
import type { SendOTPActionResult } from "@/modules/auth/server-actions/send-otp";

export type LoginMode = "password" | "otp";
type LoginStep = "email" | "otp";

interface LoginFlowOptions {
  initialMode?: LoginMode;
  isDevAuthAvailable?: boolean;
}

/** Where to land after signing in; anything not a same-site path becomes "/". */
function sanitizeCallbackUrl(value: string | null): string {
  return value != null && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

function getSignInErrorMessage(
  result: SignInResponse | undefined,
  t: (key: string, values?: Record<string, string | number>) => string
): string {
  switch (result?.code) {
    case AUTH_ERROR_CODES.INVALID_CREDENTIALS:
      return t("invalidCredentials");
    case AUTH_ERROR_CODES.REGISTRATION_DISABLED:
      return t("registrationDisabledDesc");
    case AUTH_ERROR_CODES.OTP_INVALID:
      return t("verifyFailed");
    case AUTH_ERROR_CODES.OTP_EXPIRED:
      return t("codeExpiredMessage");
    case AUTH_ERROR_CODES.OTP_LOCKED:
      return t("otpLockedDesc");
    case AUTH_ERROR_CODES.OTP_RATE_LIMITED:
      return t("rateLimitedDesc");
    case AUTH_ERROR_CODES.PASSWORD_RATE_LIMITED:
      return t("rateLimitedDesc");
    case AUTH_ERROR_CODES.PASSWORD_RATE_LIMIT_UNAVAILABLE:
    case AUTH_ERROR_CODES.AUTH_RATE_LIMIT_UNAVAILABLE:
      return t("rateLimitUnavailableDesc");
    default:
      return result?.error != null ? t("errorDesc") : t("unexpectedError");
  }
}

function getSendOTPErrorMessage(
  result: Extract<SendOTPActionResult, { ok: false }>,
  t: (key: string, values?: Record<string, string | number>) => string,
  fallbackKey: "sendCodeFailed" | "resendFailed"
): string {
  switch (result.code) {
    case "rate_limited":
      return t("rateLimitedDesc");
    case "rate_limit_unavailable":
      return t("rateLimitUnavailableDesc");
    case "config_error":
      return t("errorConfigurationDesc");
    case "invalid_email":
      return t("invalidEmailFormat");
    case "email_not_configured":
      return t("emailAuthNotConfigured");
    case "email_send_failed":
      return t("emailSendFailed");
    case "unexpected":
      return t("unexpectedError");
    default:
      return t(fallbackKey);
  }
}

export function useLoginFlow(
  t: (key: string, values?: Record<string, string | number>) => string,
  { initialMode = "password", isDevAuthAvailable = false }: LoginFlowOptions = {}
) {
  const router = useRouter();
  const locale = useLocale();
  const callbackUrl = sanitizeCallbackUrl(useSearchParams().get("callbackUrl"));

  // The whole flow is one page's worth of state. Reloading in the middle of it
  // drops the draft and returns to the email step, which is the honest outcome:
  // the code that was sent is still valid, and asking for another is one tap.
  const [mode, setModeState] = useState<LoginMode>(initialMode);
  const [step, setStep] = useState<LoginStep>("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [canResendAt, setCanResendAt] = useState<number | null>(null);
  const [otpExpired, setOtpExpired] = useState(false);
  const [resendPending, setResendPending] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setOtpExpiry = (nextExpiresAt: number | null, nextCanResendAt: number | null) => {
    setExpiresAt(nextExpiresAt);
    setCanResendAt(nextCanResendAt);
    setOtpExpired(false);
  };

  const setMode = (nextMode: LoginMode) => {
    if (isLoading || resendPending) return;
    setError(null);
    setPassword("");
    setOtp("");
    setModeState(nextMode);
    setStep("email");
  };

  const finishSignIn = (result: SignInResponse | undefined) => {
    if (result?.ok && result.error == null) {
      setPassword("");
      router.push(callbackUrl);
      router.refresh();
      return true;
    }
    if (result?.code === AUTH_ERROR_CODES.OTP_EXPIRED) setOtpExpired(true);
    setPassword("");
    setError(getSignInErrorMessage(result, t));
    setIsLoading(false);
    return false;
  };

  const handlePasswordLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const submittedEmail = formData.get("email");
    const submittedPassword = formData.get("password");
    if (typeof submittedEmail !== "string" || typeof submittedPassword !== "string") return;
    if (submittedEmail === "" || submittedPassword === "") return;

    setEmail(submittedEmail);
    setIsLoading(true);
    setError(null);
    try {
      finishSignIn(
        await signIn("password", {
          email: submittedEmail,
          password: submittedPassword,
          locale,
          redirect: false,
          callbackUrl,
        })
      );
    } catch {
      setPassword("");
      setError(t("unexpectedError"));
      setIsLoading(false);
    }
  };

  const handleSendOTP = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submittedEmail = new FormData(event.currentTarget).get("email");
    if (typeof submittedEmail !== "string" || submittedEmail === "") return;
    setEmail(submittedEmail);
    setIsLoading(true);
    setError(null);
    try {
      const result = await sendOTPAction(submittedEmail, locale);
      if (!result.ok) {
        setError(getSendOTPErrorMessage(result, t, "sendCodeFailed"));
        return;
      }
      setOtpExpiry(result.expiresAt, result.canResendAt);
      setOtp("");
      setModeState("otp");
      setStep("otp");
    } catch {
      setError(t("unexpectedError"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOTP = async () => {
    if (otpExpired) {
      setError(t("verifyExpired"));
      return;
    }
    if (!/^\d{6}$/.test(otp)) {
      setError(t("invalidCode"));
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      finishSignIn(await signIn("otp", { email, otp, locale, redirect: false, callbackUrl }));
    } catch {
      setError(t("unexpectedError"));
      setIsLoading(false);
    }
  };

  const handleResendOTP = async () => {
    if (resendPending) return;
    setError(null);
    setResendPending(true);
    try {
      const result = await sendOTPAction(email, locale);
      if (!result.ok) {
        setError(getSendOTPErrorMessage(result, t, "resendFailed"));
        return;
      }
      setOtpExpiry(result.expiresAt, result.canResendAt);
      setOtp("");
      setError(null);
    } catch {
      setError(t("resendFailed"));
    } finally {
      setResendPending(false);
    }
  };

  const handleChangeEmail = () => {
    if (resendPending) return;
    setError(null);
    setOtp("");
    setStep("email");
  };

  const handleDevSignIn = async () => {
    if (!isDevAuthAvailable) return;
    setIsLoading(true);
    setError(null);
    try {
      finishSignIn(await signIn("dev", { locale, redirect: false, callbackUrl }));
    } catch {
      setError(t("devSignInFailed"));
      setIsLoading(false);
    }
  };

  return {
    callbackUrl,
    mode,
    step,
    email,
    password,
    otp,
    isLoading,
    error,
    expiresAt,
    canResendAt,
    resendPending,
    otpExpired,
    isDevAuthAvailable,
    setMode,
    setEmail,
    setPassword,
    setOtp,
    handlePasswordLogin,
    handleSendOTP,
    handleVerifyOTP,
    handleResendOTP,
    handleChangeEmail,
    handleOTPExpired: () => {
      setOtpExpired(true);
      setError(t("verifyExpired"));
    },
    handleDevSignIn,
  };
}
