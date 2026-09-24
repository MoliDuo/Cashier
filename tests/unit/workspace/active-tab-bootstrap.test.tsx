import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";

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

let cookieValues: Record<string, string> = {};

vi.mock("@/modules/workspace/server/resolve-authenticated-home", () => ({
  resolveAuthenticatedHome: resolveAuthenticatedHomeMock,
}));

vi.mock("@/modules/workspace/server/ledger-page-bootstrap", () => ({
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

// The page reads the scope and device-zone cookies before it prefetches. Both
// are external input, so the test drives them through this store instead of a
// request scope that does not exist in a unit test.
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) => {
      const value = cookieValues[name];
      return value == null ? undefined : { name, value };
    },
  })),
}));

vi.mock("next-intl/server", () => ({
  getMessages: getMessagesMock,
  getLocale: vi.fn(() => Promise.resolve("en")),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    HydrationBoundary: ({ children }: { children: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});

// The client tree is never mounted here — the assertions read the props the
// server component hands it — so the real client component would only drag its
// hook graph into the test.
vi.mock("@/modules/workspace/ui/LedgerPageClient", () => ({
  LedgerPageClient: (_props: Record<string, unknown>) =>
    React.createElement("div", { "data-testid": "ledger-page-client" }),
}));

import { ActiveTab } from "@/app/(protected)/_active-tab";
import { LedgerPageClient } from "@/modules/workspace/ui/LedgerPageClient";

const BOOK_B = "20000000-0000-4000-8000-00000000000b";

type AnyElement = React.ReactElement<Record<string, unknown>>;

function isElement(node: unknown): node is AnyElement {
  return React.isValidElement(node);
}

function findByName(node: unknown, name: string): AnyElement | null {
  if (!isElement(node)) return null;
  const type = node.type as { name?: string } | string;
  if (typeof type !== "string" && type?.name === name) return node;
  const children = (node.props as { children?: unknown }).children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = findByName(child, name);
    if (found != null) return found;
  }
  return null;
}

/**
 * Walks the element tree the server component returns, running the pieces React
 * would run on the server: the suspended bootstrap resolves the page data, and
 * the content component forwards what it resolved. Nothing is mounted, so no
 * client hook is exercised.
 */
async function resolveClientProps(): Promise<Record<string, unknown>> {
  const tree = await ActiveTab({ searchParams: {} });
  const bootstrap = findByName(tree, "ActiveTabBootstrap");
  if (bootstrap == null) throw new Error("ActiveTabBootstrap was not rendered");
  const boundary = await (
    bootstrap.type as (props: Record<string, unknown>) => Promise<React.ReactNode>
  )(bootstrap.props);
  const content = findByName(boundary, "ActiveContent");
  if (content == null) throw new Error("ActiveContent was not rendered");
  const client = (content.type as (props: Record<string, unknown>) => AnyElement)(content.props);
  expect(client.type).toBe(LedgerPageClient);
  return client.props as Record<string, unknown>;
}

function bootstrapPageData() {
  return {
    dehydratedState: { queries: [], mutations: [] },
    initialCategories: [],
    initialBooks: [],
    initialBookId: null,
    ledgerToday: "2026-01-01",
  };
}

describe("active tab bootstrap book scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cookieValues = {};
    resolveAuthenticatedHomeMock.mockResolvedValue({
      ledgerId: "ledger-1",
      ledgerDto: {
        id: "ledger-1",
        userId: "user-1",
        settings: { mainCurrency: "USD" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      session: { user: { id: "user-1", email: "user@test.com" } },
    });
    getMessagesMock.mockResolvedValue({
      Common: { notFound: "Not found" },
      LedgerPage: {},
      Stream: {},
      Details: {},
      Stats: {},
      Settings: {},
    });
  });

  it("passes the remembered book to the bootstrap so a thrown error cannot forget it", async () => {
    cookieValues.CASHIER_BOOK_SCOPE = BOOK_B;
    getLedgerPageBootstrapMock.mockRejectedValue(new Error("database is down"));

    const props = await resolveClientProps();

    expect(props.initialBookId).toBe(BOOK_B);
  });

  it("falls back to the remembered book when the bootstrap answers nothing", async () => {
    cookieValues.CASHIER_BOOK_SCOPE = BOOK_B;
    getLedgerPageBootstrapMock.mockResolvedValue(null);

    const props = await resolveClientProps();

    expect(props.initialBookId).toBe(BOOK_B);
  });

  it("uses the server-resolved scope once the bootstrap succeeds", async () => {
    cookieValues.CASHIER_BOOK_SCOPE = BOOK_B;
    // The book was archived between the request and the live-list check, so the
    // server resolved 总账; the cookie must not override that verdict.
    getLedgerPageBootstrapMock.mockResolvedValue(bootstrapPageData());

    const props = await resolveClientProps();

    expect(props.initialBookId).toBeNull();
  });

  it("keeps the device zone the cookie named, even when the bootstrap throws", async () => {
    cookieValues.CASHIER_TIME_ZONE = "Asia/Shanghai";
    getLedgerPageBootstrapMock.mockRejectedValue(new Error("database is down"));

    const props = await resolveClientProps();

    // The page it hands the client is the only thing that can date the first
    // render; a failed prefetch must not take the device's answer with it.
    expect(props.initialDeviceTimeZone).toBe("Asia/Shanghai");
  });

  it("drops a device zone the runtime cannot format with", async () => {
    cookieValues.CASHIER_TIME_ZONE = "Not/AZone";
    getLedgerPageBootstrapMock.mockRejectedValue(new Error("database is down"));

    expect((await resolveClientProps()).initialDeviceTimeZone).toBeNull();
  });

  it("keeps 总账 for an absent or malformed cookie", async () => {
    getLedgerPageBootstrapMock.mockRejectedValue(new Error("database is down"));

    expect((await resolveClientProps()).initialBookId).toBeNull();

    cookieValues.CASHIER_BOOK_SCOPE = "not-a-uuid";
    expect((await resolveClientProps()).initialBookId).toBeNull();

    cookieValues.CASHIER_BOOK_SCOPE = "all";
    expect((await resolveClientProps()).initialBookId).toBeNull();
  });
});
