"use client";
import { useTranslations } from "next-intl";
import { Mail, CheckCircle } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { textRoleClassName } from "@/components/typography";

function Verify() {
  const t = useTranslations("Auth");
  const searchParams = useSearchParams();
  const email = searchParams.get("email") ?? "";

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg px-4">
      <div className="max-w-md w-full text-center">
        {/* Success Icon */}
        <div className="mb-8">
          <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle aria-hidden="true" className="w-10 h-10 text-primary" />
          </div>
        </div>

        {/* Title */}
        <h1 className={textRoleClassName("pageTitle", "mb-2")}>{t("checkEmail")}</h1>

        {/* Description */}
        <p className={textRoleClassName("bodyMuted", "mb-6")}>
          {t("checkEmailDesc", { email: email !== "" ? email : t("yourEmail") })}
        </p>

        {/* Email Icon Card */}
        <div className="bg-surface rounded-xl border border-border p-6 mb-6">
          <div className="flex items-center justify-center gap-3 text-text">
            <Mail aria-hidden="true" className="w-5 h-5 text-muted-foreground" />
            <span className="font-medium">{email}</span>
          </div>
        </div>

        {/* Expiry Note */}
        <p className={textRoleClassName("bodyMuted", "mb-6")}>
          {t("linkExpires", { minutes: 15 })}
        </p>

        {/* Didn't receive email */}
        <div className={textRoleClassName("bodyMuted")}>
          <span>{t("didNotReceive")}</span>
          <Link href="/login" className="ml-1 text-primary hover:underline">
            {t("resend")}
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * `?email=` is only known at request time, so the reading half sits behind a
 * boundary. The fallback is empty: this page is one short confirmation, and a
 * skeleton of it would flash for longer than the text takes to arrive.
 */
export default function VerifyPage() {
  return (
    <Suspense>
      <Verify />
    </Suspense>
  );
}
