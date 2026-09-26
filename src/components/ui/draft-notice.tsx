"use client";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { textRoleClassName } from "@/components/typography";

interface DraftNoticeProps {
  /** The draft was made against a version that has since changed. */
  outdated?: boolean;
  disabled?: boolean;
  onDiscard: () => void;
}

/** Says a form holds input kept from an earlier visit, with a way to drop it. */
export function DraftNotice({ outdated = false, disabled = false, onDiscard }: DraftNoticeProps) {
  const t = useTranslations("Common");
  return (
    <div
      role="status"
      className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface2 px-3 py-2"
    >
      <p className={textRoleClassName("meta")}>
        {outdated ? t("draftOutdated") : t("draftRestored")}
      </p>
      <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={onDiscard}>
        {t("discard")}
      </Button>
    </div>
  );
}
