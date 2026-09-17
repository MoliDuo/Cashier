"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { usePullReveal } from "@/modules/workspace/hooks/usePullReveal";
import { revealRows } from "@/modules/workspace/pull-reveal";
import { useMemberScopeRevealStore } from "@/lib/store/member-scope-reveal";
import type { RecordScope } from "@/modules/ledger/filters";

interface MemberScopeRevealProps {
  scope: RecordScope;
  onScopeChange: (scope: RecordScope) => void;
  myNickname: string;
  partnerNickname: string;
}

/**
 * The hidden member switch. It sits above 流水 / 明细 / 统计 and stays closed
 * until the page is pulled down at its top, so the scope does not take a row of
 * controls on every visit.
 *
 * The grid does the animation: one auto row from `0fr` to `1fr`, with the strip
 * itself `overflow-hidden`. While it is closed the whole thing is `inert`, so
 * nothing inside is reachable by tab or by a screen reader.
 */
export function MemberScopeReveal({
  scope,
  onScopeChange,
  myNickname,
  partnerNickname,
}: MemberScopeRevealProps) {
  const t = useTranslations("MemberScope");
  const tCommon = useTranslations("Common");
  const open = useMemberScopeRevealStore((state) => state.open);
  const setOpen = useMemberScopeRevealStore((state) => state.setOpen);
  const { height, dragging, closeAfterPick } = usePullReveal({
    enabled: true,
    open,
    onOpenChange: setOpen,
  });

  const options: readonly { scope: RecordScope; label: string }[] = [
    { scope: "mine", label: t("mine", { nickname: myNickname }) },
    { scope: "partner", label: partnerNickname },
    { scope: "all", label: tCommon("allMembers") },
  ];

  return (
    <div
      data-pull-reveal={open ? "open" : "closed"}
      data-testid="member-scope-reveal"
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
          className="flex h-14 items-stretch gap-1 rounded-lg bg-surface2 p-1"
          role="group"
          aria-label={t("label")}
        >
          {options.map((option) => (
            <button
              key={option.scope}
              type="button"
              aria-pressed={scope === option.scope}
              className={cn(
                "min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-xs font-medium transition-colors duration-[var(--motion-feedback)]",
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
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
