"use client";

import { useTranslations } from "next-intl";
import { openMemberScopeReveal } from "@/lib/store/member-scope-reveal";

interface MemberScopeChipProps {
  /** The nickname the current scope is narrowed to. */
  nickname: string;
}

/**
 * What the toolbar shows while the member switch is away: which person's records
 * the list is narrowed to, and the way back into the switch for a keyboard or a
 * mouse, neither of which can pull the page down.
 *
 * The chip carries `data-pull-reveal-ignore` so the strip's tap-outside closer
 * leaves the tap alone, and it is a button, so it does not trigger the toolbar's
 * own refresh gesture either.
 */
export function MemberScopeChip({ nickname }: MemberScopeChipProps) {
  const t = useTranslations("MemberScope");
  return (
    <button
      type="button"
      data-pull-reveal-ignore
      data-testid="member-scope-chip"
      onClick={openMemberScopeReveal}
      aria-label={t("current", { nickname })}
      className="shrink-0 rounded-sm border border-primary/40 bg-primary/5 px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
    >
      {t("only", { nickname })}
    </button>
  );
}
