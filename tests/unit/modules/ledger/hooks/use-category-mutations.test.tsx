import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/query-keys";
import type { EntryCategory } from "@/modules/ledger/contracts";
import { useCategoryMutations } from "@/modules/ledger/hooks/useCategoryMutations";

const { createAction, updateAction, reorderAction, saveAction, metadataAction } = vi.hoisted(
  () => ({
    createAction: vi.fn(),
    updateAction: vi.fn(),
    reorderAction: vi.fn(),
    saveAction: vi.fn(),
    metadataAction: vi.fn(),
  })
);

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/modules/ledger/server-actions/categories", () => ({
  createEntryCategoryAction: createAction,
  updateEntryCategoryAction: updateAction,
  deleteEntryCategoryAction: vi.fn(),
  reorderEntryCategoriesAction: reorderAction,
  saveEntryCategoriesAction: saveAction,
}));
vi.mock("@/modules/ledger/server-actions/category-metadata", () => ({
  generateEntryCategoryMetadataAction: metadataAction,
}));

const category: EntryCategory = {
  id: "category-1",
  ledgerId: "ledger-1",
  name: "Food",
  sortOrder: 0,
  icon: null,
  description: null,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
  deletedAt: null,
};

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe("useCategoryMutations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    metadataAction.mockResolvedValue({ categoryId: category.id });
  });

  it("does not invalidate server state after a failed write", async () => {
    const { queryClient, wrapper } = setup();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    saveAction.mockRejectedValue(new Error("create failed"));
    const { result } = renderHook(() => useCategoryMutations("ledger-1"), { wrapper });

    await act(async () => {
      await expect(
        result.current.saveCategories.mutateAsync({
          expectedRevision: "a".repeat(64),
          categories: [],
        })
      ).rejects.toThrow("create failed");
    });

    expect(invalidate).not.toHaveBeenCalled();
  });

  it("stores saved categories and invalidates category-bearing queries", async () => {
    const { queryClient, wrapper } = setup();
    queryClient.setQueryData(queryKeys.entryCategories("ledger-1"), [
      { ...category, entryCount: 7 },
    ]);
    saveAction.mockResolvedValue([{ ...category, name: "Dining" }]);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
    const { result } = renderHook(() => useCategoryMutations("ledger-1"), { wrapper });

    await act(async () => {
      await result.current.saveCategories.mutateAsync({
        expectedRevision: "a".repeat(64),
        categories: [{ id: category.id, name: "Dining", description: null, icon: null }],
      });
    });

    expect(queryClient.getQueryData(queryKeys.entryCategories("ledger-1"))).toEqual([
      { ...category, name: "Dining" },
    ]);
    expect(invalidate.mock.calls.map(([filters]) => filters!.queryKey)).toEqual([
      queryKeys.entryCategories("ledger-1"),
      queryKeys.sourceDocumentStreamPrefix("ledger-1"),
      queryKeys.ledgerEntriesPrefix("ledger-1"),
      queryKeys.sourceDocumentDetailPrefix("ledger-1"),
      queryKeys.summaryPrefix("ledger-1"),
      queryKeys.enhancedStatsPrefix("ledger-1"),
      queryKeys.sourceDocumentStreamTotalPrefix("ledger-1"),
    ]);
  });

  it("keeps a save pending until broad invalidation settles", async () => {
    const { queryClient, wrapper } = setup();
    let resolveRefresh!: () => void;
    const refresh = new Promise<void>((resolve) => {
      resolveRefresh = resolve;
    });
    vi.spyOn(queryClient, "invalidateQueries").mockReturnValue(refresh);
    saveAction.mockResolvedValue([{ ...category, name: "Dining" }]);
    const { result } = renderHook(() => useCategoryMutations("ledger-1"), { wrapper });

    let mutation!: Promise<EntryCategory[]>;
    act(() => {
      mutation = result.current.saveCategories.mutateAsync({
        expectedRevision: "a".repeat(64),
        categories: [{ id: category.id, name: "Dining", description: null, icon: null }],
      });
    });
    await waitFor(() => expect(result.current.saveCategories.isPending).toBe(true));

    await act(async () => {
      resolveRefresh();
      await mutation;
    });
    await waitFor(() => expect(result.current.saveCategories.isSuccess).toBe(true));
  });

  it("invalidates statistics queries after a bulk category save", async () => {
    const { queryClient, wrapper } = setup();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
    saveAction.mockResolvedValue([{ ...category, name: "Dining" }]);
    const { result } = renderHook(() => useCategoryMutations("ledger-1"), { wrapper });

    await act(async () => {
      await result.current.saveCategories.mutateAsync({
        expectedRevision: "a".repeat(64),
        categories: [{ id: category.id, name: "Dining", description: null, icon: null }],
      });
    });

    expect(invalidate.mock.calls.map(([filters]) => filters!.queryKey)).toContainEqual(
      queryKeys.enhancedStatsPrefix("ledger-1")
    );
  });

  it("tracks metadata generation until its invalidation finishes", async () => {
    const { queryClient, wrapper } = setup();
    vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
    const { result } = renderHook(() => useCategoryMutations("ledger-1"), { wrapper });

    act(() => result.current.retryCategoryMetadata(category.id));
    expect(result.current.generatingCategoryIds.has(category.id)).toBe(true);
    await waitFor(() => expect(result.current.generatingCategoryIds.has(category.id)).toBe(false));
    expect(result.current.failedCategoryIds.has(category.id)).toBe(false);
  });

  it("activates polling only after metadata generation succeeds", async () => {
    const { queryClient, wrapper } = setup();
    vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
    const onMetadataGenerated = vi.fn();
    const { result } = renderHook(
      () =>
        useCategoryMutations("ledger-1", {
          onMetadataGenerated,
        }),
      { wrapper }
    );

    act(() => result.current.retryCategoryMetadata(category.id));
    await waitFor(() => expect(onMetadataGenerated).toHaveBeenCalledOnce());
  });
});
