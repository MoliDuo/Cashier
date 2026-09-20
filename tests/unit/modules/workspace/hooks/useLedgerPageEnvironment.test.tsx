import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ShellControllerProvider } from "@/components/providers/shell-controller";
import type { EntryCategoryWithCount, LedgerDto } from "@/modules/ledger/contracts";
import type { BookDto } from "@/modules/ledger/contracts";
import { getDefaultLedger } from "tests/helpers/default-ledger";

const BOOK_LONDON = "10000000-0000-4000-8000-000000000001";
const BOOK_SHANGHAI = "10000000-0000-4000-8000-000000000002";

const { getLedgerActionMock, getEntryCategoriesActionMock, getBooksActionMock, browserZone } =
  vi.hoisted(() => ({
    getLedgerActionMock: vi.fn(),
    getEntryCategoriesActionMock: vi.fn(),
    getBooksActionMock: vi.fn(),
    browserZone: { value: null as string | null },
  }));

vi.mock("@/lib/queries/ledger-query-client", () => ({
  getLedgerAction: getLedgerActionMock,
  getEntryCategoriesAction: getEntryCategoriesActionMock,
  getBooksAction: getBooksActionMock,
  getBooksIncludingArchivedAction: getBooksActionMock,
}));
vi.mock("@/modules/workspace/ui/NewRecordForms", () => ({
  preloadNewRecordModules: vi.fn(),
}));

// The browser's own zone is what jsdom cannot answer honestly, so the test
// reports it. Everything else — the cookie the hook writes back — stays real.
vi.mock("@/lib/time-zone-cookie", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/time-zone-cookie")>();
  return { ...actual, getDeviceTimeZone: () => browserZone.value };
});

import { useLedgerPageEnvironment } from "@/modules/workspace/hooks/useLedgerPageEnvironment";

const ledgerDto: LedgerDto = {
  id: "ledger-1",
  settings: { ...getDefaultLedger("en").settings, mainCurrency: "USD" },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function book(id: string, timeZone: string | null): BookDto {
  return { id, ledgerId: "ledger-1", name: id, timeZone, sortOrder: 1, archivedAt: null };
}

type EnvironmentProps = {
  scope: string | null;
  initialBooks?: readonly BookDto[];
  initialDeviceTimeZone: string | null;
  /**
   * False starts the hook with no server-provided ledger or categories, the way
   * a client-side navigation does, so the query client is the only source.
   */
  withInitialData?: boolean;
};

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <ShellControllerProvider>{children}</ShellControllerProvider>
      </QueryClientProvider>
    );
  };
}

function renderEnvironment(props: EnvironmentProps) {
  return renderHook(
    (current: EnvironmentProps) =>
      useLedgerPageEnvironment({
        ledgerId: "ledger-1",
        scope: current.scope,
        ...(current.withInitialData === false
          ? {}
          : { initialLedger: ledgerDto, initialCategories: [] as EntryCategoryWithCount[] }),
        ...(current.initialBooks !== undefined ? { initialBooks: current.initialBooks } : {}),
        initialDeviceTimeZone: current.initialDeviceTimeZone,
        setIsInputOpen: vi.fn(),
      }),
    { wrapper: createWrapper(), initialProps: props }
  );
}

/**
 * Renders the hook the way the server does, where the snapshot it reads is the
 * one the server itself resolved rather than the browser's. That is the frame
 * the client hydrates, so it is the one that must agree with the markup.
 */
function renderServerFrame(props: EnvironmentProps): string {
  function Probe() {
    const environment = useLedgerPageEnvironment({
      ledgerId: "ledger-1",
      scope: props.scope,
      initialLedger: ledgerDto,
      initialCategories: [] as EntryCategoryWithCount[],
      ...(props.initialBooks !== undefined ? { initialBooks: props.initialBooks } : {}),
      initialDeviceTimeZone: props.initialDeviceTimeZone,
      setIsInputOpen: vi.fn(),
    });
    return (
      <span
        data-ready={String(environment.timeZoneReady)}
        data-device={environment.deviceTimeZone ?? ""}
        data-zone={environment.effectiveTimeZone ?? ""}
      />
    );
  }

  return renderToString(
    <QueryClientProvider client={new QueryClient()}>
      <ShellControllerProvider>
        <Probe />
      </ShellControllerProvider>
    </QueryClientProvider>
  );
}

function readFrame(html: string) {
  const ready = /data-ready="([^"]*)"/.exec(html)?.[1];
  return {
    ready: ready === "true",
    device: /data-device="([^"]*)"/.exec(html)?.[1] ?? null,
    zone: /data-zone="([^"]*)"/.exec(html)?.[1] ?? null,
  };
}

describe("useLedgerPageEnvironment time zone readiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    browserZone.value = null;
    document.cookie = "CASHIER_TIME_ZONE=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
    // The zone a request with no cookie of its own is dated by.
    vi.stubEnv("TZ", "Asia/Shanghai");
    getLedgerActionMock.mockResolvedValue(ledgerDto);
    getEntryCategoriesActionMock.mockResolvedValue([]);
    getBooksActionMock.mockResolvedValue([book(BOOK_LONDON, "Europe/London")]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("hydrates the zone the server resolved instead of the browser's own", () => {
    browserZone.value = "Asia/Tokyo";

    const frame = readFrame(
      renderServerFrame({
        scope: null,
        initialBooks: [],
        initialDeviceTimeZone: "Europe/London",
      })
    );

    // The browser this renders in would report Tokyo, and the frame it is
    // hydrating was rendered in London. The server's answer is the one first
    // frame the client produces, so the two agree.
    expect(frame).toEqual({ ready: true, device: "Europe/London", zone: "Europe/London" });
  });

  it("leaves the first frame undated when the server had no zone to resolve", () => {
    const frame = readFrame(
      renderServerFrame({ scope: null, initialBooks: [], initialDeviceTimeZone: null })
    );

    expect(frame).toEqual({ ready: false, device: "", zone: "" });
  });

  it("is ready at once for a book whose own zone is fixed", () => {
    const { result } = renderEnvironment({
      scope: BOOK_LONDON,
      initialBooks: [book(BOOK_LONDON, "Europe/London")],
      initialDeviceTimeZone: null,
    });

    expect(result.current.timeZoneReady).toBe(true);
    expect(result.current.effectiveTimeZone).toBe("Europe/London");
  });

  it("dates 总账 by the device and does not inherit a book's fixed zone", () => {
    browserZone.value = "Asia/Tokyo";
    const { result } = renderEnvironment({
      scope: null,
      initialBooks: [book(BOOK_LONDON, "Europe/London")],
      initialDeviceTimeZone: "Asia/Tokyo",
    });

    expect(result.current.timeZoneReady).toBe(true);
    expect(result.current.effectiveTimeZone).toBe("Asia/Tokyo");
  });

  it("waits for the book list once a book is viewed, then dates by that book", async () => {
    let resolveBooks: (rows: BookDto[]) => void = () => {};
    getBooksActionMock.mockReturnValue(
      new Promise<BookDto[]>((resolve) => {
        resolveBooks = resolve;
      })
    );
    browserZone.value = "Asia/Tokyo";

    const { result } = renderEnvironment({
      scope: BOOK_LONDON,
      initialDeviceTimeZone: "Asia/Tokyo",
    });

    // The book's own zone may be the answer, so the tab must not commit to the
    // device's before the list has named the book.
    expect(result.current.timeZoneReady).toBe(false);

    resolveBooks([book(BOOK_LONDON, "Europe/London")]);

    await waitFor(() => expect(result.current.timeZoneReady).toBe(true));
    expect(result.current.effectiveTimeZone).toBe("Europe/London");
  });

  it("does not wait for ever when the book list fails", async () => {
    getBooksActionMock.mockRejectedValue(new Error("books are down"));
    browserZone.value = "Asia/Tokyo";

    const { result } = renderEnvironment({
      scope: BOOK_LONDON,
      initialDeviceTimeZone: "Asia/Tokyo",
    });

    // A failed list is a retryable error, not a reason to hold the tab in a
    // skeleton: the device zone dates it and the list keeps its own retry.
    await waitFor(() => expect(result.current.timeZoneReady).toBe(true));
    expect(result.current.effectiveTimeZone).toBe("Asia/Tokyo");
  });

  it("updates the date range when the viewed book changes zone", () => {
    browserZone.value = "Asia/Tokyo";
    const { result, rerender } = renderEnvironment({
      scope: BOOK_LONDON,
      initialBooks: [book(BOOK_LONDON, "Europe/London"), book(BOOK_SHANGHAI, "Asia/Shanghai")],
      initialDeviceTimeZone: "Asia/Tokyo",
    });

    expect(result.current.effectiveTimeZone).toBe("Europe/London");

    rerender({
      scope: BOOK_SHANGHAI,
      initialBooks: [book(BOOK_LONDON, "Europe/London"), book(BOOK_SHANGHAI, "Asia/Shanghai")],
      initialDeviceTimeZone: "Asia/Tokyo",
    });

    expect(result.current.effectiveTimeZone).toBe("Asia/Shanghai");

    rerender({
      scope: null,
      initialBooks: [book(BOOK_LONDON, "Europe/London"), book(BOOK_SHANGHAI, "Asia/Shanghai")],
      initialDeviceTimeZone: "Asia/Tokyo",
    });

    expect(result.current.effectiveTimeZone).toBe("Asia/Tokyo");
  });

  it("writes the device zone where the next request can read it", async () => {
    browserZone.value = "Asia/Tokyo";

    renderEnvironment({ scope: null, initialBooks: [], initialDeviceTimeZone: null });

    await waitFor(() => expect(document.cookie).toContain("CASHIER_TIME_ZONE=Asia/Tokyo"));
  });

  it("serves the server-provided ledger and categories without a browser round trip", () => {
    renderEnvironment({ scope: null, initialBooks: [], initialDeviceTimeZone: "Asia/Tokyo" });

    expect(getLedgerActionMock).not.toHaveBeenCalled();
    expect(getEntryCategoriesActionMock).not.toHaveBeenCalled();
  });

  it("reads the ledger and categories through the session query client when the server sent none", async () => {
    getLedgerActionMock.mockResolvedValue({
      ...ledgerDto,
      settings: { ...ledgerDto.settings, mainCurrency: "EUR" },
    });
    getEntryCategoriesActionMock.mockResolvedValue([]);

    const { result } = renderEnvironment({
      scope: null,
      initialBooks: [],
      initialDeviceTimeZone: "Asia/Tokyo",
      withInitialData: false,
    });

    await waitFor(() => expect(getLedgerActionMock).toHaveBeenCalledWith("ledger-1"));
    expect(getEntryCategoriesActionMock).toHaveBeenCalledWith("ledger-1");
    await waitFor(() => expect(result.current.mainCurrency).toBe("EUR"));
  });

  it("falls back to the deployment zone when the browser cannot name one", async () => {
    browserZone.value = null;

    const { result } = renderEnvironment({
      scope: null,
      initialBooks: [],
      initialDeviceTimeZone: null,
    });

    // Waiting for a zone that will never arrive would leave the tab on its
    // skeleton for good; the deployment's own zone is what the server would
    // have used, so the tab is dated at least as well as it was before.
    await waitFor(() => expect(result.current.timeZoneReady).toBe(true));
    expect(result.current.effectiveTimeZone).toBe("Asia/Shanghai");
    expect(document.cookie).not.toContain("CASHIER_TIME_ZONE=");
  });
});
