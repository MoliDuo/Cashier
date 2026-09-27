"use client";
import type { MouseEvent, ReactNode } from "react";
import { ArrowLeft, Plus, Settings, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { textRoleClassName } from "@/components/typography";
import type { LedgerTab } from "@/lib/ledger-tabs";
import { AmountText } from "@/modules/currency/ui/amount-text";
import { useWorkspaceStore } from "@/modules/workspace/store";
import { BookSwitcher } from "./BookSwitcher";
import { ledgerPageCopy } from "@/copy/app";

interface LedgerTopBarProps {
  activeTab: LedgerTab;
  disabled: boolean;
  /** The desktop tabs; phones carry them in the bottom bar instead. */
  navigation: ReactNode;
  onOpenInput: () => void;
  onInputIntent: () => void;
  settingsHref: string;
  onOpenSettings: () => void;
  /** Leaves 设置 for the tab it was opened from. */
  onLeaveSettings: () => void;
}

/**
 * The ledger's top bar. On 账目 and 统计 it holds the book switcher and the
 * gear (and, from md up, the tabs and 记一笔; below md, the list's total
 * between them); on 设置 it is a back arrow and
 * the page's name, since the book being viewed has no bearing there.
 */
export function LedgerTopBar({
  activeTab,
  disabled,
  navigation,
  onOpenInput,
  onInputIntent,
  settingsHref,
  onOpenSettings,
  onLeaveSettings,
}: LedgerTopBarProps) {
  const inSettings = activeTab === "settings";
  const headerTotal = useWorkspaceStore((state) => state.headerTotal);
  const openSettings = (event: MouseEvent<HTMLAnchorElement>) => {
    // A plain click moves within the app. A modified one opens the link as
    // usual, and so does a click before the page is ready: a plain link still
    // works then, where the in-app move would have to be dropped.
    if (disabled || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onOpenSettings();
  };

  return (
    <>
      <div className="flex min-w-0 flex-1 items-center gap-1 md:flex-none md:gap-3">
        {inSettings ? (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onLeaveSettings}
              disabled={disabled}
              aria-label={ledgerPageCopy.back}
              title={ledgerPageCopy.back}
            >
              <ArrowLeft className="size-5" aria-hidden="true" />
            </Button>
            <h1 className={textRoleClassName("sectionTitle")}>{ledgerPageCopy.settings}</h1>
          </>
        ) : (
          <>
            <span className="hidden items-center gap-2 pl-1 font-semibold text-text md:inline-flex">
              <Wallet className="size-5 text-primary" aria-hidden="true" />
              Cashier
            </span>
            <BookSwitcher disabled={disabled} />
          </>
        )}
      </div>
      {/* A phone's bar has no tabs, so the list's total sits in the middle;
          the two sides share the rest equally, which keeps it centred. */}
      {!inSettings && headerTotal != null ? (
        <div className="flex shrink-0 justify-center whitespace-nowrap md:hidden">
          <AmountText variant="summary">{headerTotal}</AmountText>
        </div>
      ) : null}
      <div className="hidden h-full flex-1 justify-center md:flex">{navigation}</div>
      <div className="flex flex-1 items-center justify-end gap-1 md:flex-none md:gap-2">
        <Button
          type="button"
          size="sm"
          className="hidden gap-1.5 md:inline-flex"
          onClick={onOpenInput}
          onPointerEnter={onInputIntent}
          onFocus={onInputIntent}
          disabled={disabled}
        >
          <Plus className="size-4" aria-hidden="true" />
          {ledgerPageCopy.newRecord}
        </Button>
        {inSettings ? null : (
          <a
            href={settingsHref}
            onClick={openSettings}
            aria-label={ledgerPageCopy.settings}
            title={ledgerPageCopy.settings}
            className="inline-flex size-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface2 hover:text-text"
          >
            <Settings className="size-5" aria-hidden="true" />
          </a>
        )}
      </div>
    </>
  );
}
