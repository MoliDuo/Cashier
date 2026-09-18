"use client";
import type { Ledger } from "@/modules/ledger/contracts";
import { useRouter } from "@/i18n/routing";
import type { EntryCategoryWithCount } from "@/modules/ledger/contracts";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { SettingsTab } from "./SettingsTab";
import type { InterfaceLanguage } from "@/modules/auth/contracts";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useSettingsLeaveGuard } from "@/modules/ledger/hooks/useSettingsLeaveGuard";
import { textRoleClassName } from "@/components/typography";
import type { BookDto } from "@/modules/ledger/contracts";

interface SettingsPageClientProps {
  ledger: Ledger;
  initialCategories: EntryCategoryWithCount[];
  ledgerId: string;
  /** The switcher's books, hydrated by the page bootstrap. */
  initialBooks: readonly BookDto[];
  /** The same list plus the archived rows, for the 分账 section. */
  initialBooksIncludingArchived: readonly BookDto[];
  /** The account's login addresses, hydrated by the server. */
  initialEmails?: readonly string[];
  userEmail?: string;
  hasPassword?: boolean;
  passwordUpdatedAt?: string | null;
  interfaceLanguage?: InterfaceLanguage;
}

export function SettingsPageClient({
  ledger,
  initialCategories,
  ledgerId,
  initialBooks,
  initialBooksIncludingArchived,
  initialEmails,
  userEmail,
  hasPassword,
  passwordUpdatedAt,
  interfaceLanguage,
}: SettingsPageClientProps) {
  const router = useRouter();
  const t = useTranslations("Settings");
  const tCommon = useTranslations("Common");
  const { leaveConfirmOpen, attemptLeave, confirmLeave, cancelLeave } = useSettingsLeaveGuard({
    managePopState: true,
  });

  return (
    <div className="mx-auto w-full min-w-0 max-w-6xl overflow-x-clip px-4 py-4 sm:px-6 sm:py-8">
      <div className="flex items-center gap-4 mb-6">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => attemptLeave(() => router.back())}
          aria-label={tCommon("back")}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className={textRoleClassName("pageTitle", "truncate")}>{t("title")}</h1>
      </div>

      <SettingsTab
        ledger={ledger}
        initialCategories={initialCategories}
        ledgerId={ledgerId}
        initialBooks={initialBooks}
        initialBooksIncludingArchived={initialBooksIncludingArchived}
        {...(initialEmails !== undefined ? { initialEmails } : {})}
        {...(userEmail !== undefined ? { userEmail } : {})}
        {...(hasPassword !== undefined ? { hasPassword } : {})}
        {...(passwordUpdatedAt !== undefined ? { passwordUpdatedAt } : {})}
        {...(interfaceLanguage !== undefined ? { interfaceLanguage } : {})}
      />
      <ConfirmDialog
        open={leaveConfirmOpen}
        onOpenChange={(open) => (open ? undefined : cancelLeave())}
        title={tCommon("unsavedChangesTitle")}
        description={tCommon("unsavedChangesDescription")}
        cancelLabel={tCommon("continueEditing")}
        confirmLabel={tCommon("discardAndContinue")}
        variant="destructive"
        onConfirm={confirmLeave}
      />
    </div>
  );
}
