import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EntryCategoryWithCount } from "@/modules/ledger/contracts";
import { useCategoryPresetSwitch } from "@/modules/ledger/hooks/useCategoryPresetSwitch";

const { applyPreset } = vi.hoisted(() => ({ applyPreset: vi.fn() }));

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/modules/ledger/server-actions/categories", () => ({
  applyCategoryPresetAction: applyPreset,
}));

const custom: EntryCategoryWithCount = {
  id: "category-1",
  ledgerId: "ledger-1",
  name: "Custom",
  description: null,
  icon: null,
  sortOrder: 0,
  createdAt: "2026-09-14T00:00:00.000Z",
  updatedAt: "2026-09-14T00:00:00.000Z",
  deletedAt: null,
  entryCount: 3,
};

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { wrapper };
}

describe("useCategoryPresetSwitch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    applyPreset.mockResolvedValue({
      categories: [],
      changed: true,
      movedEntryCount: 0,
      createdCategoryCount: 13,
      removedCategoryCount: 0,
      retainedCategoryCount: 0,
    });
  });

  it("retains a separate mapping draft while switching between presets", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(
      () => useCategoryPresetSwitch({ ledgerId: "ledger-1", categories: [custom], locale: "zh" }),
      { wrapper }
    );
    act(() => result.current.openDialog());
    await waitFor(() => expect(result.current.isPreparing).toBe(false));

    act(() => result.current.choosePreset("concise"));
    act(() => result.current.setMapping(custom.id, 2));
    act(() => result.current.choosePreset("default"));
    act(() => result.current.setMapping(custom.id, null));
    act(() => result.current.choosePreset("concise"));

    expect(result.current.mappings[custom.id]).toBe(2);
    act(() => result.current.choosePreset("default"));
    expect(result.current.mappings[custom.id]).toBeNull();
  });

  it("allows an empty ledger to apply a preset", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(
      () => useCategoryPresetSwitch({ ledgerId: "ledger-1", categories: [], locale: "zh" }),
      { wrapper }
    );
    act(() => result.current.openDialog());
    await waitFor(() => expect(result.current.isPreparing).toBe(false));

    expect(result.current.summary.unsetCount).toBe(0);
    expect(result.current.canConfirm).toBe(true);
  });

  it("blocks a frozen draft after the server category collection changes", async () => {
    const { wrapper } = setup();
    const { result, rerender } = renderHook(
      ({ categories }) =>
        useCategoryPresetSwitch({ ledgerId: "ledger-1", categories, locale: "zh" }),
      { wrapper, initialProps: { categories: [custom] } }
    );
    act(() => result.current.openDialog());
    await waitFor(() => expect(result.current.isPreparing).toBe(false));
    act(() => result.current.setMapping(custom.id, 0));

    rerender({ categories: [{ ...custom, updatedAt: "2026-09-14T00:01:00.000Z" }] });

    expect(result.current.serverChanged).toBe(true);
    expect(result.current.canConfirm).toBe(false);
    await act(async () => result.current.confirm());
    expect(applyPreset).not.toHaveBeenCalled();
  });

  it("keeps dirty input when close is cancelled", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(
      () => useCategoryPresetSwitch({ ledgerId: "ledger-1", categories: [custom], locale: "zh" }),
      { wrapper }
    );
    act(() => result.current.openDialog());
    await waitFor(() => expect(result.current.isPreparing).toBe(false));
    act(() => result.current.setMapping(custom.id, 0));
    act(() => result.current.closeDialog());

    expect(result.current.discardOpen).toBe(true);
    expect(result.current.open).toBe(true);
    expect(result.current.mappings[custom.id]).toBe(0);
    act(() => result.current.setDiscardOpen(false));
    expect(result.current.open).toBe(true);
    expect(result.current.mappings[custom.id]).toBe(0);
  });
});
