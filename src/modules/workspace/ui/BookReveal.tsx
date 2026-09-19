"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { usePullReveal } from "@/modules/workspace/hooks/usePullReveal";
import { revealRows } from "@/modules/workspace/pull-reveal";
import {
  clearBookRevealTrigger,
  hasBookRevealTrigger,
  restoreBookRevealFocus,
  useBookRevealStore,
} from "@/lib/store/book-reveal";
import type { BookDto } from "@/modules/ledger/contracts";
import type { RecordScope } from "@/modules/ledger/filters";

interface BookRevealProps {
  books: readonly BookDto[];
  scope: RecordScope;
  onScopeChange: (scope: RecordScope) => void;
}

/**
 * The hidden book switcher. It sits above 流水 / 明细 / 统计 and stays closed
 * until the page is pulled down at its top, so switching books does not take a
 * row of controls on every visit.
 *
 * 总账 comes first, then the books in their configured order. The view itself
 * follows this device's last choice — the first visit shows 总账 — and picking
 * here is what the page remembers. The strip scrolls sideways once there are
 * more books than fit.
 *
 * The grid does the animation: one auto row from `0fr` to `1fr`, with the strip
 * itself `overflow-hidden`. While it is closed the whole thing is `inert`, so
 * nothing inside is reachable by tab or by a screen reader.
 *
 * The toolbar trigger cannot hand focus to the strip by itself — the strip
 * renders above the whole tab — so opening moves focus to the picked option,
 * and Escape (already the strip's own close) hands it back to the trigger.
 */
export function BookReveal({ books, scope, onScopeChange }: BookRevealProps) {
  const t = useTranslations("BookScope");
  const open = useBookRevealStore((state) => state.open);
  const setOpen = useBookRevealStore((state) => state.setOpen);
  const stripRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef(new Map<string, HTMLButtonElement>());
  const { height, dragging, closeAfterPick } = usePullReveal({
    enabled: true,
    open,
    onOpenChange: setOpen,
  });

  // Focus follows the strip, but only when a control opened it: the strip
  // renders above the whole tab, so a keyboard user who pressed the chip or the
  // 分账 button would otherwise have to tab through the page to reach it. A
  // gesture-opened strip leaves focus exactly where it was. On close, focus goes
  // back to the trigger whenever it was still inside the strip.
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      if (hasBookRevealTrigger()) optionRefs.current.get(scope ?? "all")?.focus();
      return;
    }
    if (!wasOpenRef.current) return;
    wasOpenRef.current = false;
    const active = document.activeElement;
    if (stripRef.current?.contains(active) === true) restoreBookRevealFocus();
    else clearBookRevealTrigger();
  }, [open, scope]);

  const options: readonly { scope: RecordScope; label: string }[] = [
    { scope: null, label: t("all") },
    ...books.map((book) => ({ scope: book.id as RecordScope, label: book.name })),
  ];

  return (
    <div
      data-pull-reveal={open ? "open" : "closed"}
      data-testid="book-reveal"
      // The same inset as the toolbar box below it, so the strip reads as part
      // of the tab rather than as a band across the viewport.
      className={cn(
        "mx-2 mb-2 grid overflow-hidden sm:mb-4",
        !dragging && "transition-[grid-template-rows] duration-200 ease-out"
      )}
      style={{ gridTemplateRows: revealRows(height) }}
      {...(open ? {} : { inert: true })}
    >
      <div className="min-h-0">
        <div
          ref={stripRef}
          className="flex h-14 items-stretch gap-1 overflow-x-auto rounded-lg bg-surface2 p-1"
          role="group"
          aria-label={t("label")}
        >
          {options.map((option) => (
            <button
              key={option.scope ?? "all"}
              type="button"
              ref={(node) => {
                const key = option.scope ?? "all";
                if (node == null) optionRefs.current.delete(key);
                else optionRefs.current.set(key, node);
              }}
              aria-pressed={scope === option.scope}
              className={cn(
                "min-w-0 shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors duration-[var(--motion-feedback)]",
                books.length > 2 ? "shrink-0" : "flex-1",
                scope === option.scope
                  ? "bg-surface text-primary shadow-sm"
                  : "text-muted-foreground hover:text-text"
              )}
              onClick={() => {
                if (scope !== option.scope) onScopeChange(option.scope);
                // Held open for a moment so the press is visible.
                closeAfterPick();
              }}
            >
              <span className="block max-w-40 truncate">{option.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
