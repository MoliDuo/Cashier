"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { startRegistration } from "@simplewebauthn/browser";
import { isCancelledCeremony, usePasskeySupport } from "./use-passkey-support";
import {
  finishEnrollmentAction,
  startEnrollmentAction,
  type EnrollActionErrorCode,
} from "@/modules/auth/server-actions/enroll";

/**
 * Adds the account's passkey from an `account:enroll` link and signs in with
 * it. `token` is null when the page already knows the link cannot be used.
 */
export function useEnrollFlow(token: string | null) {
  const t = useTranslations("Enroll");
  const router = useRouter();
  const passkeySupported = usePasskeySupport();
  const [linkValid, setLinkValid] = useState(token != null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fail = (code: EnrollActionErrorCode) => {
    switch (code) {
      case "invalid_link":
        setLinkValid(false);
        return;
      case "duplicate":
        setError(t("duplicate"));
        return;
      case "expired":
        setError(t("expired"));
        return;
      case "rate_limited":
        setError(t("rateLimited"));
        return;
      case "rate_limit_unavailable":
        setError(t("rateLimitUnavailable"));
        return;
      case "invalid":
        setError(t("failed"));
        return;
      default:
        setError(t("unexpected"));
    }
  };

  const enroll = async () => {
    if (token == null || pending) return;
    setPending(true);
    setError(null);
    try {
      const start = await startEnrollmentAction(token);
      if (!start.ok) {
        fail(start.code);
        return;
      }
      let response;
      try {
        response = await startRegistration({ optionsJSON: start.options });
      } catch (ceremonyError) {
        if (!isCancelledCeremony(ceremonyError)) setError(t("failed"));
        return;
      }
      const result = await finishEnrollmentAction(
        token,
        start.challengeId,
        response,
        t("passkeyName")
      );
      if (!result.ok) {
        fail(result.code);
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError(t("unexpected"));
    } finally {
      setPending(false);
    }
  };

  return { linkValid, passkeySupported, pending, error, enroll };
}
