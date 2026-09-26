import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Ledger } from "@/modules/ledger/contracts";
import { getDefaultLedger } from "tests/helpers/default-ledger";

const { queryState, refetchQueries, BOOKS } = vi.hoisted(() => ({
  queryState: { status: "success" },
  refetchQueries: vi.fn(),
  BOOKS: [
    {
      id: "book-1",
      ledgerId: "ledger-1",
      name: "共同支出",
      timeZone: null,
      sortOrder: 1,
      archivedAt: null,
    },
  ],
}));

vi.mock("@/modules/auth/server-actions/sign-in", () => ({
  signOutAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/ledger/ledger-1/settings",
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
    refetchQueries,
  }),
  // The login-email list and the book list both read through useQuery; the
  // books are hydrated from 设置's own props, so only the emails need data here.
  useQuery: ({ initialData }: { initialData?: unknown }) => ({
    data: initialData,
    isPending: false,
  }),
  useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "system", setTheme: vi.fn() }),
}));

vi.mock("@/modules/ledger/hooks/useBooks", () => ({
  useBooks: () => ({
    books: BOOKS,
    booksQuery: { status: "success" },
  }),
}));

vi.mock("@/modules/ledger/hooks/useLedgerSettings", () => ({
  useLedgerSettings: ({ ledger }: { ledger: unknown }) => ({
    ledger,
    categories: [],
    uncategorizedCount: 0,
    credentials: [],
    settingsQueryStatus: queryState.status,
    updateLedgerMutation: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
    saveCategories: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
    generatingCategoryIds: new Set<string>(),
    failedCategoryIds: new Set<string>(),
    retryCategoryMetadata: vi.fn(),
    createCredential: { mutateAsync: vi.fn(), reset: vi.fn() },
    setCredentialBook: { mutateAsync: vi.fn() },
    deleteCredential: { mutateAsync: vi.fn() },
  }),
}));

vi.mock("@/modules/ledger/ui/CurrencySection", () => ({
  CurrencySection: () => <div>Currency section</div>,
}));

vi.mock("@/modules/ledger/ui/CategorySection", () => ({
  CategorySection: () => <div>Category section</div>,
}));

vi.mock("@/modules/ledger/ui/ServiceCredentialSection", () => ({
  ServiceCredentialSection: () => <div>Service credentials</div>,
}));

import { SettingsTab } from "@/modules/ledger/ui/SettingsTab";

describe("SettingsTab account authentication controls", () => {
  beforeEach(() => {
    queryState.status = "success";
    vi.clearAllMocks();
  });
  it("lists the login emails and sign-out, but no destructive account mutations", () => {
    const ledger: Ledger = {
      id: "ledger-1",
      settings: { ...getDefaultLedger().settings },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    render(
      <SettingsTab
        ledger={ledger}
        initialCategories={[]}
        initialBooks={BOOKS}
        userEmail="person@example.com"
      />
    );

    // Required: the address that signs in, the way to add another, and sign-out.
    expect(screen.getAllByText("person@example.com").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: /sign out|退出登录/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add email|添加邮箱/i })).toBeInTheDocument();
    // The only removal is per-address, and it is disabled while one remains:
    // the account must keep at least one login email.
    expect(screen.getByRole("button", { name: /移除 person@example\.com/ })).toBeDisabled();

    expect(screen.queryByRole("button", { name: /clear data|清空数据/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /delete account|删除账户/i })
    ).not.toBeInTheDocument();
  });

  it("keeps loaded settings visible when a query fails and exposes a local retry", () => {
    queryState.status = "error";
    const ledger: Ledger = {
      id: "ledger-1",
      settings: { ...getDefaultLedger().settings },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    render(
      <SettingsTab
        ledger={ledger}
        initialCategories={[]}
        initialBooks={BOOKS}
        userEmail="person@example.com"
      />
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign out|退出登录/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(refetchQueries).toHaveBeenCalledWith({
      type: "active",
      predicate: expect.any(Function),
    });
    const { predicate } = refetchQueries.mock.calls[0]![0] as {
      predicate: (query: { queryKey: readonly unknown[] }) => boolean;
    };
    // Retrying has to reach both book lists — the switcher's live one and the
    // archived-inclusive one the 分账 section reads — while leaving the rest of
    // the ledger alone.
    expect(predicate({ queryKey: ["ledger", "books"] })).toBe(true);
    expect(predicate({ queryKey: ["ledger", "books", "including-archived"] })).toBe(true);
    expect(predicate({ queryKey: ["ledger", "source-documents", "stream"] })).toBe(false);
    expect(predicate({ queryKey: ["ledger", "categories"] })).toBe(true);
  });
});
