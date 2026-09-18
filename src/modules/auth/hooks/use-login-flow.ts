"use client";

import { useEffect, useState } from "react";
import { signIn, type SignInResponse } from "next-auth/react";
import { useLocale } from "next-intl";
import { useRouter } from "@/i18n/routing";
import { AUTH_ERROR_CODES } from "@/modules/auth/errors";
import { sendOTPAction } from "@/modules/auth/server-actions/send-otp";
import type { SendOTPActionResult } from "@/modules/auth/server-actions/send-otp";
import { useLoginDraftStore } from "@/modules/auth/login-draft-store";
import { useLoginUrlState, type LoginMode } from "./use-login-url-state";
import { useOtpContextStorage } from "./use-otp-context-storage";

export type { LoginMode } from "./use-login-url-state";

interface LoginFlowOptions {
  initialMode?: LoginMode;
  isDevAuthAvailable?: boolean;
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
  const { callbackUrl, mode, step, rawStep, writeFlowUrl } = useLoginUrlState(initialMode);
  const email = useLoginDraftStore((state) => state.email);
  const otp = useLoginDraftStore((state) => state.otp);
  const resendPending = useLoginDraftStore((state) => state.resendPending);
  const otpExpired = useLoginDraftStore((state) => state.otpExpired);
  const expiresAt = useLoginDraftStore((state) => state.expiresAt);
  const canResendAt = useLoginDraftStore((state) => state.canResendAt);
  const setEmail = useLoginDraftStore((state) => state.setEmail);
  const setOtp = useLoginDraftStore((state) => state.setOtp);
  const setResendPending = useLoginDraftStore((state) => state.setResendPending);
  const setOtpExpiry = useLoginDraftStore((state) => state.setOtpExpiry);
  const setOtpExpired = useLoginDraftStore((state) => state.setOtpExpired);
  const resetDraft = useLoginDraftStore((state) => state.reset);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [passwordMode, setPasswordMode] = useState(mode);
  if (passwordMode !== mode) {
    setPasswordMode(mode);
    setPassword("");
  }

  // resendPending lives in a module-level store, so if a previous page load's
  // handleResendOTP was interrupted before its `finally` ran (e.g. unmount
  // mid-request), it would otherwise stay stuck true and permanently disable
  // both tabs for the rest of this page load. Clear it on mount.
  useEffect(() => {
    setResendPending(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { contextHydrated, clearOtpContext, storeOtpContext } = useOtpContextStorage({
    mode,
    rawStep,
    setEmail,
    setOtpExpiry,
    writeFlowUrl,
  });

  const setMode = (nextMode: LoginMode) => {
    if (isLoading || resendPending) return;
    setError(null);
    clearOtpContext();
    setPassword("");
    setOtp("");
    writeFlowUrl(nextMode, "email");
  };

  const finishSignIn = (result: SignInResponse | undefined) => {
    if (result?.ok && result.error == null) {
      clearOtpContext();
      setPassword("");
      resetDraft();
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
      storeOtpContext({
        email: submittedEmail,
        expiresAt: result.expiresAt,
        canResendAt: result.canResendAt,
      });
      writeFlowUrl("otp", "otp");
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
      storeOtpContext({ email, expiresAt: result.expiresAt, canResendAt: result.canResendAt });
    } catch {
      setError(t("resendFailed"));
    } finally {
      setResendPending(false);
    }
  };

  const handleChangeEmail = () => {
    if (resendPending) return;
    setError(null);
    clearOtpContext();
    setOtp("");
    writeFlowUrl("otp", "email");
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
    contextHydrated,
    isDevAuthAvailable,
    setMode,
    setEmail: (nextEmail: string) => {
      if (nextEmail !== email) clearOtpContext();
      setEmail(nextEmail);
    },
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
