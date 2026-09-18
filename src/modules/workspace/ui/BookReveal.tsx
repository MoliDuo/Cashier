"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { usePullReveal } from "@/modules/workspace/hooks/usePullReveal";
import { revealRows } from "@/modules/workspace/pull-reveal";
import { useBookRevealStore } from "@/lib/store/book-reveal";
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
 * 总账 comes first and is the default, then the books in their configured order.
 * The strip scrolls sideways once there are more books than fit.
 *
 * The grid does the animation: one auto row from `0fr` to `1fr`, with the strip
 * itself `overflow-hidden`. While it is closed the whole thing is `inert`, so
 * nothing inside is reachable by tab or by a screen reader.
 */
export function BookReveal({ books, scope, onScopeChange }: BookRevealProps) {
  const t = useTranslations("BookScope");
  const open = useBookRevealStore((state) => state.open);
  const setOpen = useBookRevealStore((state) => state.setOpen);
  const { height, dragging, closeAfterPick } = usePullReveal({
    enabled: true,
    open,
    onOpenChange: setOpen,
  });

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
          className="flex h-14 items-stretch gap-1 overflow-x-auto rounded-lg bg-surface2 p-1"
          role="group"
          aria-label={t("label")}
        >
          {options.map((option) => (
            <button
              key={option.scope ?? "all"}
              type="button"
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
