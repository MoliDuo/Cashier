"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { startRegistration } from "@simplewebauthn/browser";
import { isCancelledCeremony, usePasskeySupport } from "./use-passkey-support";
import {
  finishEnrollmentAction,
  startEnrollmentAction,
  type EnrollActionErrorCode,
} from "@/modules/auth/server-actions/enroll";
import { enrollCopy } from "@/copy/auth";

/**
 * Adds the account's passkey from an `account:enroll` link and signs in with
 * it. `token` is null when the page already knows the link cannot be used.
 */
export function useEnrollFlow(token: string | null) {
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
        setError(enrollCopy.duplicate);
        return;
      case "expired":
        setError(enrollCopy.expired);
        return;
      case "rate_limited":
        setError(enrollCopy.rateLimited);
        return;
      case "rate_limit_unavailable":
        setError(enrollCopy.rateLimitUnavailable);
        return;
      case "invalid":
        setError(enrollCopy.failed);
        return;
      default:
        setError(enrollCopy.unexpected);
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
        if (!isCancelledCeremony(ceremonyError)) setError(enrollCopy.failed);
        return;
      }
      const result = await finishEnrollmentAction(
        token,
        start.challengeId,
        response,
        enrollCopy.passkeyName
      );
      if (!result.ok) {
        fail(result.code);
        return;
      }
      router.replace("/");
      router.refresh();
    } catch {
      setError(enrollCopy.unexpected);
    } finally {
      setPending(false);
    }
  };

  return { linkValid, passkeySupported, pending, error, enroll };
}
