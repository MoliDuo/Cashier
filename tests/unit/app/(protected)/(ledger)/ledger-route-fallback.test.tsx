import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const pathname = vi.hoisted(() => ({ current: "/stream" }));

vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));
vi.mock("@/components/skeletons/TabSkeletons", () => ({
  EntriesTabSkeleton: () => <div data-testid="stream-skeleton" />,
  DetailsTabSkeleton: () => <div data-testid="details-skeleton" />,
  StatsTabSkeleton: () => <div data-testid="stats-skeleton" />,
  SettingsTabSkeleton: () => <div data-testid="settings-skeleton" />,
}));

import { LedgerRouteFallback } from "@/app/(protected)/(ledger)/_route-fallback";

describe("LedgerRouteFallback", () => {
  it.each([
    ["/stream", "stream-skeleton"],
    ["/details", "details-skeleton"],
    ["/stats", "stats-skeleton"],
    ["/settings", "settings-skeleton"],
  ] as const)("renders the skeleton of %s", (route, testId) => {
    pathname.current = route;
    render(<LedgerRouteFallback />);
    expect(screen.getByTestId(testId)).toBeInTheDocument();
  });
});
