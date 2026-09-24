import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";

// --------------------------------------------------------------------------
// Hoisted mocks — run before any imports
// --------------------------------------------------------------------------
const {
  resolveAuthenticatedHomeMock,
  getMessagesMock,
  getLedgerPageBootstrapMock,
  scheduleProcessingRecoveryAfterMock,
} = vi.hoisted(() => ({
  resolveAuthenticatedHomeMock: vi.fn(),
  getMessagesMock: vi.fn(),
  getLedgerPageBootstrapMock: vi.fn(),
  scheduleProcessingRecoveryAfterMock: vi.fn(),
}));

// --------------------------------------------------------------------------
// Module mocks — installed before components are imported
// --------------------------------------------------------------------------
vi.mock("@/modules/workspace/server/resolve-authenticated-home", () => ({
  resolveAuthenticatedHome: resolveAuthenticatedHomeMock,
}));

vi.mock("@/modules/workspace/application/queries/get-ledger-page-bootstrap", () => ({
  getLedgerPageBootstrap: getLedgerPageBootstrapMock,
}));

vi.mock("@/application/processing/schedule-processing-recovery", () => ({
  scheduleProcessingRecoveryAfter: scheduleProcessingRecoveryAfterMock,
}));

vi.mock("@/app/(protected)/_ledger-bootstrap-fallback", () => ({
  LedgerBootstrapFallback: () =>
    React.createElement("div", { "data-testid": "ledger-bootstrap-fallback" }),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("REDIRECT");
  }),
}));

// The page reads the device zone cookie before it prefetches; there is no
// request scope in a unit test, and the zone is optional by design.
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: () => undefined })),
}));

vi.mock("next-intl/server", () => ({
  getMessages: getMessagesMock,
  getLocale: vi.fn(() => Promise.resolve("en")),
}));

vi.mock("next-intl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-intl")>();
  return {
    ...actual,
    NextIntlClientProvider: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    useTranslations: () => (key: string) => key,
    useLocale: () => "en",
  };
});

// Mock ActiveShell so we don't need client-side hook mocks (usePathname, useSearchParams, etc.)
vi.mock("@/app/(protected)/_active-shell", () => ({
  ActiveShell: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "active-shell" }, children),
}));

// Mock the LedgerPageClient with a simple placeholder
vi.mock("@/modules/workspace/ui/LedgerPageClient", () => ({
  LedgerPageClient: (_props: Record<string, unknown>) =>
    React.createElement("div", { "data-testid": "ledger-page-client" }),
}));

// Mock skeleton components
vi.mock("@/components/skeletons", () => ({
  LedgerPageSkeleton: () => React.createElement("div", { "data-testid": "ledger-page-skeleton" }),
}));

vi.mock("@/components/skeletons/TabSkeletons", () => ({
  EntriesTabSkeleton: () => React.createElement("div", { "data-testid": "entries-tab-skeleton" }),
}));

// HydrationBoundary mock — just renders children
vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    HydrationBoundary: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});

// --------------------------------------------------------------------------
// Imports after all mocks
// --------------------------------------------------------------------------
import { ActiveTab } from "@/app/(protected)/_active-tab";
import { UnauthorizedError } from "@/lib/errors";

describe("protected home streaming boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveAuthenticatedHomeMock.mockResolvedValue({
      userId: "user-1",
      ledgerId: "ledger-1",
      ledgerDto: {
        id: "ledger-1",
        userId: "user-1",
        settings: { mainCurrency: "USD" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      session: {
        user: {
          id: "user-1",
          email: "user@test.com",
          name: "Test",
          image: null,
        },
      },
      locale: "en",
    });
    getMessagesMock.mockResolvedValue({
      Common: { notFound: "Not found" },
      LedgerPage: { stream: "Stream" },
    });
    getLedgerPageBootstrapMock.mockResolvedValue({
      dehydratedState: { queries: [], mutations: [] },
      initialCategories: [],
      initialStatsDate: new Date("2026-01-01T00:00:00.000Z"),
    });
  });

  it("schedules recovery and bootstraps the authorized ledger", async () => {
    await ActiveTab({ searchParams: {} });

    expect(resolveAuthenticatedHomeMock).toHaveBeenCalled();
    expect(scheduleProcessingRecoveryAfterMock).toHaveBeenCalledWith("ledger-1");
    expect(getLedgerPageBootstrapMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ledgerId: "ledger-1",
        initialTab: "stream",
        ledgerDto: expect.objectContaining({ id: "ledger-1" }),
      }),
      expect.any(Object)
    );
  });

  it("throws non-UnauthorizedError from resolveAuthenticatedHome", async () => {
    // Simulate a non-auth error (e.g., database failure)
    const dbError = new Error("Database connection failed");
    resolveAuthenticatedHomeMock.mockRejectedValue(dbError);

    // ActiveTab should rethrow the error, not swallow it
    await expect(ActiveTab({ searchParams: {} })).rejects.toThrow("Database connection failed");
  });

  it("redirects on UnauthorizedError from resolveAuthenticatedHome", async () => {
    resolveAuthenticatedHomeMock.mockRejectedValue(new UnauthorizedError());

    // The redirect mock throws "REDIRECT" — ActiveTab should let it propagate
    // since redirect() throws internally.
    await expect(ActiveTab({ searchParams: {} })).rejects.toThrow("REDIRECT");
  });
});
