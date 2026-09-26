"use client";
import { BarChart3, ListChecks, Plus, ReceiptText, RefreshCw, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LedgerTab } from "@/lib/ledger-tabs";
import { ledgerPageCopy } from "@/copy/app";
import { commonCopy } from "@/copy/common";

interface TabNavigationProps {
  disabled?: boolean;
  /** True while the tab the reader is on is refetching from its own tap. */
  refreshing?: boolean;
  activeTab: LedgerTab;
  /** The active destination is the tab's refresh, so it is called for it too. */
  onTabChange: (tab: LedgerTab) => void;
  onOpenInput: () => void;
  onInputIntent?: () => void;
  /** Called when an inactive destination receives pointer or keyboard job. */
  onTabIntent?: (tab: LedgerTab) => void;
}

const TAB_CONFIG: Array<{
  value: LedgerTab;
  icon: typeof ReceiptText;
}> = [
  { value: "stream", icon: ReceiptText },
  { value: "details", icon: ListChecks },
  { value: "stats", icon: BarChart3 },
  { value: "settings", icon: Settings },
];

export function TabNavigation({
  disabled = false,
  refreshing = false,
  activeTab,
  onTabChange,
  onOpenInput,
  onInputIntent,
  onTabIntent,
}: TabNavigationProps) {
  const labelFor = (tab: LedgerTab) => {
    switch (tab) {
      case "stream":
        return ledgerPageCopy.stream;
      case "details":
        return ledgerPageCopy.details;
      case "stats":
        return ledgerPageCopy.stats;
      case "settings":
        return ledgerPageCopy.settings;
    }
  };

  return (
    <nav
      aria-label={ledgerPageCopy.navigation}
      className="grid h-full w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)_3.5rem_minmax(0,1fr)_minmax(0,1fr)] items-stretch"
    >
      {TAB_CONFIG.slice(0, 2).map(({ value, icon: Icon }) => (
        <NavButton
          key={value}
          disabled={disabled}
          active={activeTab === value}
          icon={Icon}
          label={labelFor(value)}
          disabledTitle={commonCopy.loading}
          refreshTitle={commonCopy.refresh}
          refreshing={refreshing && activeTab === value}
          refreshingLabel={commonCopy.refreshing}
          onClick={() => onTabChange(value)}
          onIntent={
            onTabIntent != null && value !== activeTab ? () => onTabIntent(value) : undefined
          }
        />
      ))}

      <button
        type="button"
        disabled={disabled}
        onClick={onOpenInput}
        onPointerEnter={onInputIntent}
        onPointerDown={onInputIntent}
        onFocus={onInputIntent}
        className="m-auto inline-flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-bg active:scale-[0.98]"
        aria-label={ledgerPageCopy.newRecord}
      >
        <Plus className="h-5 w-5" aria-hidden="true" />
      </button>

      {TAB_CONFIG.slice(2).map(({ value, icon: Icon }) => (
        <NavButton
          key={value}
          disabled={disabled}
          active={activeTab === value}
          icon={Icon}
          label={labelFor(value)}
          disabledTitle={commonCopy.loading}
          refreshTitle={commonCopy.refresh}
          refreshing={refreshing && activeTab === value}
          refreshingLabel={commonCopy.refreshing}
          onClick={() => onTabChange(value)}
          onIntent={
            onTabIntent != null && value !== activeTab ? () => onTabIntent(value) : undefined
          }
        />
      ))}
    </nav>
  );
}

interface NavButtonProps {
  active: boolean;
  icon: typeof ReceiptText;
  label: string;
  onClick: () => void;
  onIntent?: (() => void) | undefined;
  disabled?: boolean;
  disabledTitle: string;
  /** Names the second job the active destination carries. */
  refreshTitle: string;
  refreshing: boolean;
  refreshingLabel: string;
}

function NavButton({
  active,
  icon: Icon,
  label,
  onClick,
  onIntent,
  disabled,
  disabledTitle,
  refreshTitle,
  refreshing,
  refreshingLabel,
}: NavButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? disabledTitle : active ? refreshTitle : undefined}
      aria-busy={refreshing || undefined}
      onPointerEnter={onIntent}
      onPointerDown={onIntent}
      onFocus={onIntent}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative inline-flex h-full min-w-0 flex-col items-center justify-center gap-0.5 px-1 text-micro font-medium transition-colors after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-transparent md:flex-row md:gap-1 md:px-2 md:text-sm",
        disabled
          ? "cursor-not-allowed text-muted-foreground/60"
          : active
            ? "bg-surface2/60 text-text after:bg-primary"
            : "text-muted-foreground hover:bg-surface2/40 hover:text-text"
      )}
    >
      {refreshing ? (
        <RefreshCw className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
      ) : (
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      )}
      <span className="truncate">{label}</span>
      <span aria-live="polite" className="sr-only">
        {refreshing ? refreshingLabel : ""}
      </span>
    </button>
  );
}
