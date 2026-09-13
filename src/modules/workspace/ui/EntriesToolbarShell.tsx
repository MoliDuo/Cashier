import type { MouseEvent, ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AmountText } from "@/modules/currency/ui/amount-text";

/**
 * Controls that own their own gesture: the select button, the filter panel and
 * anything either of them opens. Radix renders popovers in a portal, but React
 * still bubbles their events through this box, so an open panel has to opt out
 * by role as well.
 */
const OWN_GESTURE_SELECTOR = [
  "button",
  "a",
  "input",
  "select",
  "textarea",
  "[contenteditable='true']",
  "[role='button']",
  "[role='checkbox']",
  "[role='combobox']",
  "[role='dialog']",
  "[role='listbox']",
  "[role='menu']",
  "[role='menuitem']",
  "[role='option']",
  "[role='textbox']",
].join(", ");

interface EntriesToolbarShellProps {
  children: ReactNode;
  /** The span the total covers, e.g. 本月 or 2026年9月1日 - 9月30日. A total with
   * no range attached cannot be read on its own. */
  rangeLabel?: string | undefined;
  totalLabel?: string | undefined;
  batchActions?: ReactNode | undefined;
  syncStatus?: ReactNode | undefined;
  className?: string;
  /** Manual refresh for the tab. The box is its trigger, so the bar above the
   * tabs carries no button wherever this is passed. */
  onRefresh?: (() => Promise<unknown> | unknown) | undefined;
  isRefreshing?: boolean | undefined;
}

export function EntriesToolbarShell({
  children,
  rangeLabel,
  totalLabel,
  batchActions,
  syncStatus,
  className = "",
  onRefresh,
  isRefreshing = false,
}: EntriesToolbarShellProps) {
  const t = useTranslations("Common");
  const refresh = async () => {
    if (onRefresh == null || isRefreshing) return;
    try {
      await onRefresh();
    } catch {
      toast.error(t("refreshFailed"));
    }
  };
  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest(OWN_GESTURE_SELECTOR) != null) {
      return;
    }
    void refresh();
  };

  return (
    <div
      data-testid="entries-toolbar"
      className={`relative mx-2 mb-2 flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-2 sm:mb-4 ${className}`}
      {...(onRefresh != null ? { onClick: handleClick } : {})}
    >
      {children}
      {syncStatus != null ? (
        <div
          className="order-last min-w-0 basis-full text-xs text-muted-foreground sm:order-none sm:basis-auto"
          data-testid="toolbar-sync-status"
        >
          {syncStatus}
        </div>
      ) : null}
      {onRefresh != null ? (
        // Doubling as the trigger keeps the refresh reachable by keyboard, which
        // clicking the box is not. Centred on the box rather than between the
        // controls, because it names a gesture the whole box answers to;
        // nothing in the row grows, so the middle is always free. While the
        // refetch runs it spins, the way the refresh button on the other tabs
        // does; the label stays for screen readers.
        <button
          type="button"
          data-testid="toolbar-refresh-hint"
          onClick={() => void refresh()}
          disabled={isRefreshing}
          title={t("refresh")}
          aria-busy={isRefreshing || undefined}
          className="absolute left-1/2 top-1/2 flex shrink-0 -translate-x-1/2 -translate-y-1/2 select-none items-center gap-1.5 rounded-sm px-0.5 text-micro text-muted-foreground/60 transition-colors hover:text-muted-foreground"
        >
          {isRefreshing ? (
            <>
              <RefreshCw aria-hidden="true" className="h-4 w-4 animate-spin" />
              <span className="sr-only">{t("refreshing")}</span>
            </>
          ) : (
            t("refreshHint")
          )}
        </button>
      ) : null}
      {rangeLabel != null || (totalLabel != null && totalLabel !== "") ? (
        <div className="ml-auto flex min-w-0 items-center gap-2 whitespace-nowrap">
          {rangeLabel != null ? (
            <span className="text-xs text-muted-foreground sm:text-sm">{rangeLabel}</span>
          ) : null}
          {totalLabel != null && totalLabel !== "" ? (
            <AmountText variant="summary">{totalLabel}</AmountText>
          ) : null}
        </div>
      ) : null}
      {/* The batch band takes the room the browsing controls leave rather than
          a row of its own, so the back control stays on its line. */}
      {batchActions != null ? <div className="min-w-0 flex-1">{batchActions}</div> : null}
    </div>
  );
}
