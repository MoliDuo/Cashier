import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EntryCategoryWithCount } from "@/modules/ledger/contracts";
import { CategorySection } from "@/modules/ledger/ui/CategorySection";

const { applyPresetAction } = vi.hoisted(() => ({ applyPresetAction: vi.fn() }));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "zh",
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/modules/ledger/server-actions/categories", () => ({
  applyCategoryPresetAction: applyPresetAction,
}));
vi.mock("@/modules/ledger/ui/category-assignment-context", () => ({
  useCategoryAssignment: () => ({
    ledgerId: "ledger-1",
    job: null,
    isActive: false,
    isReadError: false,
    refresh: vi.fn(),
    dismiss: vi.fn(),
    registerSubmittedJob: vi.fn(),
  }),
}));

const category: EntryCategoryWithCount = {
  id: "category-1",
  ledgerId: "ledger-1",
  name: "Meals",
  description: null,
  icon: null,
  sortOrder: 0,
  createdAt: "2026-08-07T00:00:00.000Z",
  updatedAt: "2026-08-07T00:00:00.000Z",
  deletedAt: null,
  entryCount: 3,
};

function renderSection(props: { uncategorizedCount?: number } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const onSaveCategories = vi
    .fn()
    .mockResolvedValue([category, { ...category, id: "category-2", name: "Travel", sortOrder: 1 }]);
  render(
    <CategorySection
      ledgerId="ledger-1"
      categories={[category]}
      onSaveCategories={onSaveCategories}
      {...props}
    />,
    { wrapper }
  );
  return { onSaveCategories };
}

describe("CategorySection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps category changes in a draft and submits them atomically", async () => {
    const { onSaveCategories } = renderSection();

    fireEvent.click(await screen.findByRole("button", { name: "manageCategories" }));
    fireEvent.change(screen.getByLabelText("newCategoryPlaceholder"), {
      target: { value: "Travel" },
    });
    fireEvent.click(screen.getByRole("button", { name: "addCategory" }));

    expect(onSaveCategories).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(onSaveCategories).toHaveBeenCalledOnce());
    expect(onSaveCategories).toHaveBeenCalledWith({
      expectedRevision: expect.stringMatching(/^[0-9a-f]{64}$/),
      categories: [
        {
          id: "category-1",
          name: "Meals",
          description: null,
          icon: null,
        },
        {
          clientId: expect.any(String),
          name: "Travel",
          description: null,
          icon: null,
        },
      ],
    });
  });

  it("blocks a preset switch until every category has a destination", async () => {
    applyPresetAction.mockResolvedValue({
      categories: [category],
      changed: true,
      movedEntryCount: 3,
      createdCategoryCount: 6,
      removedCategoryCount: 1,
      retainedCategoryCount: 0,
    });
    renderSection();

    fireEvent.click(await screen.findByRole("button", { name: "switchPreset" }));

    // "Meals" is not a category in either preset, so nothing is preselected and
    // the switch cannot be confirmed until the user picks a destination.
    const apply = await screen.findByRole("button", { name: "presetApply" });
    expect(apply).toBeDisabled();
    expect(screen.getByText("presetSummaryNone")).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: /presetOptionConcise/ }));
    fireEvent.click(screen.getByRole("combobox", { name: "Meals" }));
    fireEvent.click(await screen.findByRole("option", { name: /吃喝/ }));

    await waitFor(() => expect(apply).toBeEnabled());
    fireEvent.click(apply);
    // The confirm step is a second dialog with its own equally labelled button.
    const confirmButtons = await screen.findAllByRole("button", { name: "presetApply" });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!);

    await waitFor(() => expect(applyPresetAction).toHaveBeenCalledOnce());
    expect(applyPresetAction).toHaveBeenCalledWith("ledger-1", {
      expectedRevision: expect.stringMatching(/^[0-9a-f]{64}$/),
      presetId: "concise",
      locale: "zh",
      mappings: [{ fromCategoryId: "category-1", toPresetIndex: 0 }],
    });
  });

  it("holds 未分类 in the last slot with nothing to press", async () => {
    renderSection({ uncategorizedCount: 2 });

    const row = await screen.findByTestId("uncategorized-row");
    expect(row).toHaveTextContent("uncategorized");
    expect(row).toHaveTextContent("categoryItemCount");

    // Below the last category, and out of reach of the editor: managing the
    // list adds no control to it, because there is no category behind it.
    const list = row.parentElement!;
    expect(list.lastElementChild).toBe(row);

    fireEvent.click(screen.getByRole("button", { name: "manageCategories" }));

    expect(screen.getByTestId("uncategorized-row")).toBe(list.lastElementChild);
    expect(within(row).queryAllByRole("button")).toHaveLength(0);
  });
});
