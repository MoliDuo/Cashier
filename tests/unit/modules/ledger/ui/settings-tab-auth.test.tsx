import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Ledger } from "@/modules/ledger/contracts";
import { getDefaultLedger } from "tests/helpers/default-ledger";

const { queryState, refetchQueries } = vi.hoisted(() => ({
  queryState: { status: "success" },
  refetchQueries: vi.fn(),
}));

vi.mock("next-auth/react", () => ({
  signOut: vi.fn(),
}));

vi.mock("@/i18n/routing", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/ledger/ledger-1/settings",
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
    refetchQueries,
  }),
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "system", setTheme: vi.fn() }),
}));

vi.mock("@/modules/ledger/hooks/useLedgerSettings", () => ({
  useLedgerSettings: () => ({
    ledger: null,
    categories: [],
    uncategorizedCount: 0,
    credentials: [],
    updateLedgerMutation: { mutate: vi.fn(), mutateAsync: vi.fn() },
    isPending: false,
    settingsQueryStatus: queryState.status,
  }),
}));

vi.mock("@/modules/ledger/hooks/useCategoryMutations", () => ({
  useCategoryMutations: () => ({
    saveCategories: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
    createCategory: { mutate: vi.fn(), mutateAsync: vi.fn() },
    updateCategory: { mutate: vi.fn(), mutateAsync: vi.fn() },
    deleteCategory: { mutate: vi.fn(), mutateAsync: vi.fn() },
    reorderCategories: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
    generatingCategoryIds: new Set<string>(),
    failedCategoryIds: new Set<string>(),
    retryCategoryMetadata: vi.fn(),
  }),
}));

vi.mock("@/modules/ledger/hooks/useCredentialMutations", () => ({
  useCredentialMutations: () => ({
    createCredential: { mutateAsync: vi.fn() },
    deleteCredential: { mutate: vi.fn() },
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

vi.mock("@/modules/ledger/ui/ExportSection", () => ({
  ExportSection: () => <div>Export data</div>,
}));

import { SettingsTab } from "@/modules/ledger/ui/SettingsTab";

describe("SettingsTab account authentication controls", () => {
  beforeEach(() => {
    queryState.status = "success";
    vi.clearAllMocks();
  });
  it("renders email change and sign-out, but not destructive account mutations", () => {
    const ledger: Ledger = {
      id: "ledger-1",
      userId: "user-1",
      settings: { ...getDefaultLedger().settings },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    render(
      <SettingsTab
        ledger={ledger}
        initialCategories={[]}
        ledgerId="ledger-1"
        userEmail="person@example.com"
      />
    );

    // Required: email and sign-out command
    expect(screen.getAllByText("person@example.com").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: /sign out|退出登录/i })).toBeInTheDocument();

    expect(
      screen.getByRole("button", { name: /changeEmailButton|change email|修改邮箱/i })
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /clear data|清空数据/i })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /delete account|删除账户/i })
    ).not.toBeInTheDocument();
  });

  it("keeps loaded settings visible when a query fails and exposes a local retry", () => {
    queryState.status = "error";
    const ledger: Ledger = {
      id: "ledger-1",
      userId: "user-1",
      settings: { ...getDefaultLedger().settings },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    render(
      <SettingsTab
        ledger={ledger}
        ledgerId="ledger-1"
        initialCategories={[]}
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
  });
});
