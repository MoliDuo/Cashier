"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { startAuthentication } from "@simplewebauthn/browser";
import { isCancelledCeremony, usePasskeySupport } from "./use-passkey-support";
import { AUTH_ERROR_CODES } from "@/modules/auth/errors";
import { sendOTPAction } from "@/modules/auth/server-actions/send-otp";
import type { SendOTPActionResult } from "@/modules/auth/server-actions/send-otp";
import {
  devSignInAction,
  finishPasskeySignInAction,
  signInWithOtpAction,
  startPasskeySignInAction,
  type SignInActionResult,
} from "@/modules/auth/server-actions/sign-in";
import { authCopy } from "@/copy/auth";

type LoginStep = "email" | "otp";

interface LoginFlowOptions {
  isDevAuthAvailable?: boolean;
}

/** Where to land after signing in; anything not a same-site path becomes "/". */
function sanitizeCallbackUrl(value: string | null): string {
  return value != null && value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

function getSignInErrorMessage(result: Extract<SignInActionResult, { ok: false }>): string {
  switch (result.code) {
    case AUTH_ERROR_CODES.REGISTRATION_DISABLED:
      return authCopy.registrationDisabledDesc;
    case AUTH_ERROR_CODES.OTP_INVALID:
      return authCopy.verifyFailed;
    case AUTH_ERROR_CODES.OTP_EXPIRED:
      return authCopy.codeExpiredMessage;
    case AUTH_ERROR_CODES.OTP_LOCKED:
      return authCopy.otpLockedDesc;
    case AUTH_ERROR_CODES.OTP_RATE_LIMITED:
    case AUTH_ERROR_CODES.PASSKEY_RATE_LIMITED:
      return authCopy.rateLimitedDesc;
    case AUTH_ERROR_CODES.AUTH_RATE_LIMIT_UNAVAILABLE:
      return authCopy.rateLimitUnavailableDesc;
    case "unexpected":
      return authCopy.unexpectedError;
    default:
      return authCopy.errorDesc;
  }
}

function getSendOTPErrorMessage(
  result: Extract<SendOTPActionResult, { ok: false }>,
  fallbackKey: "sendCodeFailed" | "resendFailed"
): string {
  switch (result.code) {
    case "rate_limited":
      return authCopy.rateLimitedDesc;
    case "rate_limit_unavailable":
      return authCopy.rateLimitUnavailableDesc;
    case "config_error":
      return authCopy.errorConfigurationDesc;
    case "invalid_email":
      return authCopy.invalidEmailFormat;
    case "email_not_configured":
      return authCopy.emailAuthNotConfigured;
    case "email_send_failed":
      return authCopy.emailSendFailed;
    case "unexpected":
      return authCopy.unexpectedError;
    default:
      return authCopy[fallbackKey];
  }
}

export function useLoginFlow({ isDevAuthAvailable = false }: LoginFlowOptions = {}) {
  const router = useRouter();
  const passkeySupported = usePasskeySupport();
  const callbackUrl = sanitizeCallbackUrl(useSearchParams().get("callbackUrl"));

  // The whole flow is one page's worth of state. Reloading in the middle of it
  // drops the draft and returns to the email step, which is the honest outcome:
  // the code that was sent is still valid, and asking for another is one tap.
  const [step, setStep] = useState<LoginStep>("email");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
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

  const finishSignIn = (result: SignInActionResult) => {
    if (result.ok) {
      router.push(callbackUrl);
      router.refresh();
      return true;
    }
    if (result.code === AUTH_ERROR_CODES.OTP_EXPIRED) setOtpExpired(true);
    setError(getSignInErrorMessage(result));
    setIsLoading(false);
    return false;
  };

  const handleSendOTP = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const submittedEmail = new FormData(event.currentTarget).get("email");
    if (typeof submittedEmail !== "string" || submittedEmail === "") return;
    setEmail(submittedEmail);
    setIsLoading(true);
    setError(null);
    try {
      const result = await sendOTPAction(submittedEmail);
      if (!result.ok) {
        setError(getSendOTPErrorMessage(result, "sendCodeFailed"));
        return;
      }
      setOtpExpiry(result.expiresAt, result.canResendAt);
      setOtp("");
      setStep("otp");
    } catch {
      setError(authCopy.unexpectedError);
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOTP = async () => {
    if (otpExpired) {
      setError(authCopy.verifyExpired);
      return;
    }
    if (!/^\d{6}$/.test(otp)) {
      setError(authCopy.invalidCode);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      finishSignIn(await signInWithOtpAction(email, otp));
    } catch {
      setError(authCopy.unexpectedError);
      setIsLoading(false);
    }
  };

  const handleResendOTP = async () => {
    if (resendPending) return;
    setError(null);
    setResendPending(true);
    try {
      const result = await sendOTPAction(email);
      if (!result.ok) {
        setError(getSendOTPErrorMessage(result, "resendFailed"));
        return;
      }
      setOtpExpiry(result.expiresAt, result.canResendAt);
      setOtp("");
      setError(null);
    } catch {
      setError(authCopy.resendFailed);
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

  // Discoverable credentials: the browser offers whichever passkeys it holds
  // for this site, so no email is asked for first.
  const handlePasskeyLogin = async () => {
    if (isLoading) return;
    setIsLoading(true);
    setError(null);
    try {
      const start = await startPasskeySignInAction();
      if (!start.ok) {
        finishSignIn(start);
        return;
      }
      let response;
      try {
        response = await startAuthentication({ optionsJSON: start.options });
      } catch (error) {
        if (!isCancelledCeremony(error)) setError(authCopy.passkeyFailed);
        setIsLoading(false);
        return;
      }
      const result = await finishPasskeySignInAction(start.challengeId, response);
      // An unknown passkey and a bad signature both come back as invalid
      // credentials, which for a passkey is not about any email address.
      if (!result.ok && result.code === AUTH_ERROR_CODES.INVALID_CREDENTIALS) {
        setError(authCopy.passkeyFailed);
        setIsLoading(false);
        return;
      }
      finishSignIn(result);
    } catch {
      setError(authCopy.unexpectedError);
      setIsLoading(false);
    }
  };

  const handleDevSignIn = async () => {
    if (!isDevAuthAvailable) return;
    setIsLoading(true);
    setError(null);
    try {
      finishSignIn(await devSignInAction());
    } catch {
      setError(authCopy.devSignInFailed);
      setIsLoading(false);
    }
  };

  return {
    callbackUrl,
    step,
    email,
    otp,
    isLoading,
    error,
    expiresAt,
    canResendAt,
    resendPending,
    otpExpired,
    isDevAuthAvailable,
    passkeySupported,
    setEmail,
    setOtp,
    handleSendOTP,
    handleVerifyOTP,
    handleResendOTP,
    handleChangeEmail,
    handleOTPExpired: () => {
      setOtpExpired(true);
      setError(authCopy.verifyExpired);
    },
    handlePasskeyLogin,
    handleDevSignIn,
  };
}
