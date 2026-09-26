"use client";

import Link from "next/link";
import { KeyRound, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { textRoleClassName } from "@/components/typography";
import { useEnrollFlow } from "../hooks/use-enroll-flow";

export function EnrollPasskeyPage({ token }: { token: string | null }) {
  const t = useTranslations("Enroll");
  const flow = useEnrollFlow(token);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4 py-8">
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-6">
        {flow.linkValid ? (
          <>
            <h1 className={textRoleClassName("pageTitle")}>{t("title")}</h1>
            <p className={textRoleClassName("bodyMuted", "mt-2")}>{t("description")}</p>
            {flow.passkeySupported ? (
              <Button
                type="button"
                className="mt-6 min-h-11 w-full"
                disabled={flow.pending}
                onClick={() => void flow.enroll()}
              >
                {flow.pending ? (
                  <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                ) : (
                  <KeyRound aria-hidden="true" className="size-4" />
                )}
                {t("submit")}
              </Button>
            ) : (
              <p className={textRoleClassName("body", "mt-6")}>{t("unsupported")}</p>
            )}
            {flow.error != null ? (
              <p
                role="alert"
                className="mt-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive"
              >
                {flow.error}
              </p>
            ) : null}
          </>
        ) : (
          <>
            <h1 className={textRoleClassName("pageTitle")}>{t("invalidLinkTitle")}</h1>
            <p className={textRoleClassName("bodyMuted", "mt-2")}>{t("invalidLinkDesc")}</p>
            <Button asChild variant="outline" className="mt-6 min-h-11 w-full">
              <Link href="/login">{t("backToLogin")}</Link>
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
