import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/skeletons/TabSkeletons", () => ({
  EntriesTabSkeleton: () => <div data-testid="stream-skeleton" />,
  DetailsTabSkeleton: () => <div data-testid="details-skeleton" />,
  StatsTabSkeleton: () => <div data-testid="stats-skeleton" />,
  SettingsTabSkeleton: () => <div data-testid="settings-skeleton" />,
}));

import { LedgerBootstrapFallback } from "@/app/(protected)/_ledger-bootstrap-fallback";

describe("LedgerBootstrapFallback", () => {
  it.each([
    ["stream", "stream-skeleton"],
    ["details", "details-skeleton"],
    ["stats", "stats-skeleton"],
    ["settings", "settings-skeleton"],
  ] as const)("renders the %s tab skeleton", (activeTab, testId) => {
    render(<LedgerBootstrapFallback activeTab={activeTab} />);
    expect(screen.getByTestId(testId)).toBeInTheDocument();
  });
});
