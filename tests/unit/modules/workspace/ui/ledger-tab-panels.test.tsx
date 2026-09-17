import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LedgerTabPanels } from "@/modules/workspace/ui/LedgerTabPanels";
import type { Ledger } from "@/modules/ledger/contracts";
import { getDefaultLedger } from "tests/helpers/default-ledger";

/**
 * The deferred panels are the ones that carry member-scoped UI, so the recorder
 * stands in for all three and records whatever each panel is rendered with.
 */
const deferredProps = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>> }));

vi.mock("next/dynamic", () => ({
  default: () => (props: Record<string, unknown>) => {
    deferredProps.calls.push(props);
    return null;
  },
}));

vi.mock("@/modules/workspace/ui/LedgerEntriesTab", () => ({
  LedgerEntriesTab: () => null,
}));

vi.mock("@/i18n/DeferredFeatureMessages", () => ({
  DeferredFeatureMessages: ({ children }: { children: unknown }) => children,
}));

vi.mock("@/components/skeletons/TabSkeletons", () => ({
  DetailsTabSkeleton: () => null,
  StatsTabSkeleton: () => null,
  SettingsTabSkeleton: () => null,
}));

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const PARTNER_ID = "10000000-0000-4000-8000-000000000002";

const ledgerFixture: Ledger = {
  id: "ledger-1",
  settings: { ...getDefaultLedger().settings, mainCurrency: "CNY" },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const baseProps = {
  recordScope: "all" as const,
  onRecordScopeChange: vi.fn(),
  userId: OWNER_ID,
  partnerUserId: PARTNER_ID,
  hidden: false,
  locale: "en",
  ledgerId: "ledger-1",
  ledger: ledgerFixture,
  categories: [],
  periodParams: { period: "all" as const },
  onFiltersChange: vi.fn(),
  advancedFilters: {},
  onCategoryDrilldown: vi.fn(),
  onDateDrilldown: vi.fn(),
};

describe("LedgerTabPanels", () => {
  beforeEach(() => {
    deferredProps.calls.length = 0;
  });

  /**
   * The settings panel renders credentials whose ownership is labelled from
   * these two ids; dropping them silently degrades every row to its fallback.
   */
  it.each(["details", "stats", "settings"] as const)(
    "forwards the member identity to the %s panel",
    (activeTab) => {
      render(<LedgerTabPanels {...baseProps} activeTab={activeTab} />);

      expect(deferredProps.calls).toHaveLength(1);
      expect(deferredProps.calls[0]).toMatchObject({
        userId: OWNER_ID,
        partnerUserId: PARTNER_ID,
        ledgerId: "ledger-1",
      });
    }
  );
});
