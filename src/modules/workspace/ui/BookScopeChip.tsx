"use client";

import { useTranslations } from "next-intl";
import { openBookReveal } from "@/lib/store/book-reveal";

interface BookScopeChipProps {
  /** The book the current view is narrowed to. */
  name: string;
}

/**
 * What the toolbar shows while the book switcher is away: which book the list is
 * narrowed to, and the way back into the switcher for a keyboard or a mouse,
 * neither of which can pull the page down.
 *
 * The chip carries `data-pull-reveal-ignore` so the strip's tap-outside closer
 * leaves the tap alone, and it is a button, so it does not trigger the toolbar's
 * own refresh gesture either.
 */
export function BookScopeChip({ name }: BookScopeChipProps) {
  const t = useTranslations("BookScope");
  return (
    <button
      type="button"
      data-pull-reveal-ignore
      data-testid="book-scope-chip"
      onClick={openBookReveal}
      aria-label={t("current", { book: name })}
      className="shrink-0 rounded-sm border border-primary/40 bg-primary/5 px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
    >
      {t("only", { book: name })}
    </button>
  );
}
