"use client";
import { useCallback, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { AppShell } from "@/modules/workspace/ui/AppShell";
import { SwipeTabSurface } from "@/modules/workspace/ui/SwipeTabSurface";
import { TabNavigation } from "@/modules/workspace/ui/TabNavigation";
import { useActiveTabQueryState } from "@/modules/workspace/hooks/useActiveTabQueryState";
import { useLedgerTabs } from "@/modules/workspace/hooks/useLedgerTabs";
import { useTabScrollRestoration } from "@/modules/workspace/hooks/useTabScrollRestoration";
import {
  ShellControllerProvider,
  useShellController,
} from "@/components/providers/shell-controller";
import type { LedgerTab } from "@/lib/ledger-tabs";
import { preloadFeatureMessages } from "@/i18n/use-feature-messages";
import { parsePeriodFromSearchParams } from "@/lib/period-utils";
import {
  getScopedLedgerSearchParams,
  readLedgerFilterParams,
  readStatsSearchParams,
} from "@/modules/workspace/ledger-url-params";
import {
  prefetchDetailsTabQuery,
  prefetchStatsTabQuery,
} from "@/modules/workspace/prefetch-ledger-tabs";
import { useBookScopeStore } from "@/lib/store/book-scope";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useSettingsLeaveGuard } from "@/modules/ledger/hooks/useSettingsLeaveGuard";

interface ActiveShellProps {
  ledgerId: string;
  children: React.ReactNode;
}

/**
 * Client-side shell that renders the AppShell, tab navigation, and the
 * active tab content. The shell renders immediately (outside the bootstrap
 * Suspense boundary) so the user sees the header and tabs while the tab
 * content loads behind a nested Suspense. Navigation stays disabled until
 * the inner content mounts, so early clicks cannot race its hydration.
 *
 * ShellControllerProvider is placed here so both the AppShell (child of
 * the provider) and the LedgerPageClient (deep in children) can access
 * the same context. The header's "+" button and status-preset buttons
 * become available when LedgerPageClient registers the real handlers via
 * setOpenInput once it mounts.
 */
export function ActiveShell({ ledgerId, children }: ActiveShellProps) {
  return (
    <ShellControllerProvider>
      <ActiveShellInner ledgerId={ledgerId}>{children}</ActiveShellInner>
    </ShellControllerProvider>
  );
}

function ActiveShellInner({ ledgerId, children }: ActiveShellProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const locale = useLocale();
  const t = useTranslations("Common");
  const queryClient = useQueryClient();
  const { ready, onInputIntent, onOpenInput } = useShellController();
  const { hasDirtyChanges, leaveConfirmOpen, attemptLeave, confirmLeave, cancelLeave } =
    useSettingsLeaveGuard();

  // The viewed book is the page's shared scope, published by LedgerPageClient
  // into the store, and a scope change is a client-side update with no server
  // render behind it. So the hover prefetch has to read it live here — a book
  // passed down from the server would be the book the last full page load
  // viewed.
  const bookId = useBookScopeStore((state) => state.bookId) ?? undefined;

  // Derive the active tab from the URL — keeps the shell and the inner
  // content in sync without duplicating state.
  const { activeTab, handleTabChange } = useLedgerTabs({
    searchParams,
    pathname,
    locale,
  });
  useTabScrollRestoration(ledgerId, activeTab);

  // The destination a reader is already on has nowhere to navigate, so it
  // carries the tab's refresh instead: every tab is reloaded from the same
  // gesture, and no tab needs a control of its own for it.
  const { isRefreshing, refreshActiveTab } = useActiveTabQueryState({ ledgerId, activeTab });
  const [refreshPending, setRefreshPending] = useState(false);

  const refreshCurrentTab = useCallback(async () => {
    // A refetch would discard whatever 设置 is holding unsaved, and a refresh
    // already under way needs no second one.
    if (hasDirtyChanges || isRefreshing || refreshPending) return;
    setRefreshPending(true);
    try {
      await refreshActiveTab();
    } catch {
      toast.error(t("refreshFailed"));
    } finally {
      setRefreshPending(false);
    }
  }, [hasDirtyChanges, isRefreshing, refreshActiveTab, refreshPending, t]);

  const guardedTabChange = useCallback(
    (tab: LedgerTab) => {
      if (!ready) return;
      if (tab === activeTab) {
        void refreshCurrentTab();
        return;
      }
      attemptLeave(() => handleTabChange(tab));
    },
    [activeTab, attemptLeave, handleTabChange, ready, refreshCurrentTab]
  );

  const preloadTabCode = useCallback(
    (tab: LedgerTab) => {
      if (tab === "details") {
        import("@/modules/workspace/ui/DetailsTab");
        void preloadFeatureMessages(queryClient, locale, "details");
      } else if (tab === "stats") {
        import("@/modules/workspace/ui/StatsTab");
        void preloadFeatureMessages(queryClient, locale, "stats");
      } else if (tab === "settings") {
        import("@/modules/ledger/ui/SettingsTab");
        void preloadFeatureMessages(queryClient, locale, "settings");
      }
    },
    [locale, queryClient]
  );

  const preloadTab = useCallback(
    (tab: LedgerTab) => {
      preloadTabCode(tab);
      if (tab === "details") {
        const scoped = getScopedLedgerSearchParams(searchParams, "details");
        void prefetchDetailsTabQuery(
          queryClient,
          ledgerId,
          bookId,
          parsePeriodFromSearchParams(scoped),
          readLedgerFilterParams(searchParams, "details")
        );
      } else if (tab === "stats") {
        void prefetchStatsTabQuery(
          queryClient,
          ledgerId,
          bookId,
          readStatsSearchParams(searchParams)
        );
      }
    },
    [bookId, ledgerId, preloadTabCode, queryClient, searchParams]
  );

  return (
    <AppShell
      navigation={
        <TabNavigation
          disabled={!ready}
          refreshing={refreshPending}
          activeTab={activeTab}
          onTabChange={guardedTabChange}
          onOpenInput={onOpenInput}
          onInputIntent={onInputIntent}
          onTabIntent={preloadTab}
        />
      }
    >
      <SwipeTabSurface
        activeTab={activeTab}
        onTabChange={guardedTabChange}
        onTabIntent={preloadTab}
      >
        {children}
      </SwipeTabSurface>
      <ConfirmDialog
        open={leaveConfirmOpen}
        onOpenChange={(open) => (open ? undefined : cancelLeave())}
        title={t("unsavedChangesTitle")}
        description={t("unsavedChangesDescription")}
        cancelLabel={t("continueEditing")}
        confirmLabel={t("discardAndContinue")}
        variant="destructive"
        onConfirm={confirmLeave}
      />
    </AppShell>
  );
}
