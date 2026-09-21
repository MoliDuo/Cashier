"use client";
import { useTranslations } from "next-intl";
import { AUTH_ERROR_CODES } from "@/modules/auth/errors";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { textRoleClassName } from "@/components/typography";

function LoginError() {
  const t = useTranslations("Auth");
  const searchParams = useSearchParams();
  const error = searchParams.get("error");
  const code = searchParams.get("code");
  const defaultMessage = { title: t("error"), desc: t("errorDesc") };
  const credentialsMessage = (() => {
    switch (code) {
      case AUTH_ERROR_CODES.REGISTRATION_DISABLED:
        return { title: t("registrationDisabled"), desc: t("registrationDisabledDesc") };
      case AUTH_ERROR_CODES.OTP_INVALID:
        return { title: t("error"), desc: t("verifyFailed") };
      case AUTH_ERROR_CODES.OTP_EXPIRED:
        return { title: t("error"), desc: t("codeExpiredMessage") };
      case AUTH_ERROR_CODES.OTP_LOCKED:
        return { title: t("rateLimited"), desc: t("otpLockedDesc") };
      case AUTH_ERROR_CODES.OTP_RATE_LIMITED:
      case AUTH_ERROR_CODES.PASSWORD_RATE_LIMITED:
        return { title: t("rateLimited"), desc: t("rateLimitedDesc") };
      case AUTH_ERROR_CODES.PASSWORD_RATE_LIMIT_UNAVAILABLE:
      case AUTH_ERROR_CODES.AUTH_RATE_LIMIT_UNAVAILABLE:
        return { title: t("error"), desc: t("rateLimitUnavailableDesc") };
      default:
        return defaultMessage;
    }
  })();
  const errorMessage = (() => {
    if (error === "CredentialsSignin") return credentialsMessage;
    switch (error) {
      case "AccessDenied":
        return { title: t("errorAccessDenied"), desc: t("errorAccessDeniedDesc") };
      case "Configuration":
        return { title: t("errorConfiguration"), desc: t("errorConfigurationDesc") };
      default:
        return defaultMessage;
    }
  })();

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg px-4">
      <div className="max-w-md w-full text-center">
        {/* Error Icon */}
        <div className="mb-8">
          <div className="w-20 h-20 bg-destructive/10 rounded-full flex items-center justify-center mx-auto">
            <AlertCircle aria-hidden="true" className="w-10 h-10 text-destructive" />
          </div>
        </div>

        {/* Title */}
        <h1 className={textRoleClassName("pageTitle", "mb-2")}>{errorMessage.title}</h1>

        {/* Description */}
        <p className={textRoleClassName("bodyMuted", "mb-8")}>{errorMessage.desc}</p>

        {/* Try Again Button */}
        <Button asChild className="h-11 px-8">
          <Link href="/login">{t("tryAgain")}</Link>
        </Button>
      </div>
    </div>
  );
}

/**
 * The page reads `?error=` and `?code=`, which Next cannot know while
 * prerendering, so the reading half sits behind a boundary. The fallback is
 * empty: the page it would replace is a single short message, and a skeleton
 * of it would flash for longer than the message takes to arrive.
 */
export default function LoginErrorPage() {
  return (
    <Suspense>
      <LoginError />
    </Suspense>
  );
}
