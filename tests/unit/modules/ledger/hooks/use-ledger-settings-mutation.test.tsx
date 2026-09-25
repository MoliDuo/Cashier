import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { describe, expect, it, vi } from "vitest";
import { useLedgerSettingsMutation } from "@/modules/ledger/hooks/useLedgerSettingsMutation";
import type { Ledger } from "@/modules/ledger/contracts";
import { getDefaultLedger } from "tests/helpers/default-ledger";

const { updateLedgerSettingsAction, toastError } = vi.hoisted(() => ({
  updateLedgerSettingsAction: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/modules/ledger/server-actions/update", () => ({ updateLedgerSettingsAction }));
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }));

const ledger: Ledger = {
  id: "ledger-1",
  settings: { ...getDefaultLedger().settings, currencies: ["USD", "CNY"] },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    () =>
      useLedgerSettingsMutation({
        expectedUpdatedAt: ledger.updatedAt,
        successMessage: "saved",
        errorMessage: "failed",
      }),
    { wrapper }
  );
  return { ...hook, invalidate };
}

const UNSUPPORTED_CURRENCY_MESSAGE = "所选币种暂不受汇率数据支持";

describe("useLedgerSettingsMutation", () => {
  it("submits the stream collapse preference", async () => {
    updateLedgerSettingsAction.mockResolvedValueOnce({ ok: true, ledger });
    const { result } = setup();

    await act(async () => result.current.mutateAsync({ collapseEntriesDefault: true }));

    expect(updateLedgerSettingsAction).toHaveBeenCalledWith({
      expectedUpdatedAt: ledger.updatedAt,
      settings: { collapseEntriesDefault: true },
    });
  });

  it("submits preferred currencies through the currencies field", async () => {
    updateLedgerSettingsAction.mockResolvedValueOnce({ ok: true, ledger });
    const { result } = setup();

    await act(async () => result.current.mutateAsync({ currencies: ["USD", "CNY"] }));

    expect(updateLedgerSettingsAction).toHaveBeenCalledWith({
      expectedUpdatedAt: ledger.updatedAt,
      settings: { currencies: ["USD", "CNY"] },
    });
  });

  it("localizes action failures without invalidating queries", async () => {
    updateLedgerSettingsAction.mockResolvedValueOnce({ ok: false, code: "unsupported_currency" });
    const { result, invalidate } = setup();

    await act(async () => {
      await expect(result.current.mutateAsync({ mainCurrency: "USD" })).rejects.toThrow(
        UNSUPPORTED_CURRENCY_MESSAGE
      );
    });

    expect(toastError).toHaveBeenCalledWith(UNSUPPORTED_CURRENCY_MESSAGE);
    expect(invalidate).not.toHaveBeenCalled();
  });
});
