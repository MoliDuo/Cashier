import {
  DetailsTabSkeleton,
  EntriesTabSkeleton,
  SettingsTabSkeleton,
  StatsTabSkeleton,
} from "@/components/skeletons/TabSkeletons";
import type { LedgerTab } from "@/lib/ledger-tabs";

interface LedgerBootstrapFallbackProps {
  activeTab: LedgerTab;
}

export function LedgerBootstrapFallback({ activeTab }: LedgerBootstrapFallbackProps) {
  if (activeTab === "details") return <DetailsTabSkeleton />;
  if (activeTab === "stats") return <StatsTabSkeleton />;
  if (activeTab === "settings") return <SettingsTabSkeleton />;
  return <EntriesTabSkeleton />;
}
