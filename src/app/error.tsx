"use client";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AlertCircle, RefreshCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { textRoleClassName } from "@/components/typography";

export default function Error({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("Error");

  useEffect(() => {
    // Log the error to an error reporting service
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-bg">
      <div className="max-w-md w-full bg-surface border border-border rounded-2xl p-8 shadow-xl text-center space-y-6">
        <div className="mx-auto w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center text-destructive">
          <AlertCircle aria-hidden="true" className="w-10 h-10" />
        </div>

        <div className="space-y-2">
          <h1 className={textRoleClassName("pageTitle")}>{t("title")}</h1>
          <p className={textRoleClassName("bodyMuted")}>
            {t("description", { message: t("title") })}
          </p>
          {error.digest != null && (
            <p className={textRoleClassName("meta", "font-mono bg-surface2 p-2 rounded mt-4")}>
              {t("errorId", { id: error.digest })}
            </p>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <Button className="flex-1 gap-2 h-11" onClick={() => window.location.reload()}>
            <RefreshCcw aria-hidden="true" className="w-4 h-4" />
            {t("retry")}
          </Button>
          <Button asChild variant="outline" className="flex-1 h-11">
            <Link href="/">{t("goHome")}</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
