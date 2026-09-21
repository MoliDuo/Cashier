import Link from "next/link";
import { useTranslations } from "next-intl";
import { AlertCircle, Home } from "lucide-react";
import { textRoleClassName } from "@/components/typography";

export default function NotFound() {
  const t = useTranslations("NotFound");

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg px-4">
      <div className="max-w-md w-full text-center">
        <div className="mb-8 flex justify-center">
          <div className="relative">
            <div className="text-9xl font-bold text-surface2 select-none">404</div>
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center">
                <AlertCircle aria-hidden="true" className="w-8 h-8 text-primary" />
              </div>
            </div>
          </div>
        </div>
        <h1 className={textRoleClassName("pageTitle", "mb-4")}>{t("title")}</h1>
        <p className={textRoleClassName("bodyMuted", "mb-8")}>{t("description")}</p>
        <Link
          href="/"
          className="inline-flex items-center justify-center px-6 py-3 border border-transparent text-base font-medium rounded-lg text-white bg-primary hover:bg-primary/90 transition-colors shadow-sm"
        >
          <Home aria-hidden="true" className="w-5 h-5 mr-2" />
          {t("backToHome")}
        </Link>
      </div>
    </div>
  );
}
