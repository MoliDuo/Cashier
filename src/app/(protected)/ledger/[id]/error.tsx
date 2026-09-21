"use client";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCcw, LayoutDashboard } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { textRoleClassName } from "@/components/typography";

export default function LedgerError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("Error");
  const tLedger = useTranslations("LedgerError");

  useEffect(() => {
    console.error("Ledger Error:", error);
  }, [error]);

  return (
    <div className="h-[calc(100vh-4rem)] flex items-center justify-center p-4">
      <div className="flex w-full max-w-md flex-col gap-6 rounded-lg border border-border bg-surface p-8 text-center shadow-sm">
        <div className="space-y-2">
          <h1 className={textRoleClassName("pageTitle")}>{tLedger("title")}</h1>
          <p className={textRoleClassName("bodyMuted")}>{tLedger("description")}</p>
        </div>

        <div className="flex flex-col gap-3">
          <Button className="w-full gap-2" onClick={() => window.location.reload()}>
            <RefreshCcw aria-hidden="true" className="w-4 h-4" />
            {t("retry")}
          </Button>
          <Button variant="outline" className="w-full gap-2" asChild>
            <Link href="/">
              <LayoutDashboard aria-hidden="true" className="w-4 h-4" />
              {tLedger("backToHome")}
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
