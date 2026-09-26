import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { commonCopy } from "@/copy/common";
import { settingsCopy } from "@/copy/settings";
import type { EntryCategoryWithCount } from "@/modules/ledger/contracts";
import { CategorySection } from "@/modules/ledger/ui/CategorySection";

const { applyPresetAction } = vi.hoisted(() => ({ applyPresetAction: vi.fn() }));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/modules/ledger/server-actions/categories", () => ({
  applyCategoryPresetAction: applyPresetAction,
}));
vi.mock("@/modules/ledger/hooks/useLedgerId", () => ({ useLedgerId: () => "ledger-1" }));
vi.mock("@/modules/ledger/ui/category-assignment-context", () => ({
  useCategoryAssignment: () => ({
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
  entryCount: 3,
};

function renderSection(
  props: { uncategorizedCount?: number; categories?: EntryCategoryWithCount[] } = {}
) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const onSaveCategories = vi
    .fn()
    .mockResolvedValue([category, { ...category, id: "category-2", name: "Travel", sortOrder: 1 }]);
  const view = render(
    <CategorySection categories={[category]} onSaveCategories={onSaveCategories} {...props} />,
    { wrapper }
  );
  const rerender = (categories: EntryCategoryWithCount[]) =>
    view.rerender(<CategorySection categories={categories} onSaveCategories={onSaveCategories} />);
  return { onSaveCategories, rerender, unmount: view.unmount };
}

describe("CategorySection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  async function addTravel() {
    fireEvent.click(await screen.findByRole("button", { name: settingsCopy.manageCategories }));
    fireEvent.change(screen.getByLabelText(settingsCopy.newCategoryPlaceholder), {
      target: { value: "Travel" },
    });
    fireEvent.click(screen.getByRole("button", { name: settingsCopy.addCategory }));
  }

  it("restores unsaved list edits after the page goes away, and discards them on request", async () => {
    const first = renderSection();
    await addTravel();
    first.unmount();

    const second = renderSection();

    expect(await screen.findByText("Travel")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(commonCopy.draftRestored);
    fireEvent.click(screen.getByRole("button", { name: commonCopy.discard }));

    expect(screen.queryByText("Travel")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: settingsCopy.manageCategories })).toBeInTheDocument();
    second.unmount();
    renderSection();
    expect(screen.getByRole("button", { name: settingsCopy.manageCategories })).toBeInTheDocument();
  });

  it("follows the server while the list is untouched", async () => {
    const { rerender } = renderSection();
    fireEvent.click(await screen.findByRole("button", { name: settingsCopy.manageCategories }));

    rerender([{ ...category, name: "Food" }]);

    expect(screen.getByText("Food")).toBeInTheDocument();
    expect(screen.queryByText(settingsCopy.categoriesChangedElsewhere)).not.toBeInTheDocument();
  });

  it("refuses to save edits over a list that changed elsewhere and offers the latest", async () => {
    const { onSaveCategories, rerender } = renderSection();
    await addTravel();

    rerender([{ ...category, name: "Food" }]);

    expect(screen.getByText(settingsCopy.categoriesChangedElsewhere)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: commonCopy.save })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: settingsCopy.reloadCategories }));

    expect(screen.getByText("Food")).toBeInTheDocument();
    expect(screen.queryByText("Travel")).not.toBeInTheDocument();
    expect(onSaveCategories).not.toHaveBeenCalled();
  });

  it("asks before an explicit cancel throws the list edits away", async () => {
    renderSection();
    await addTravel();

    fireEvent.click(screen.getByRole("button", { name: commonCopy.cancel }));
    fireEvent.click(await screen.findByRole("button", { name: commonCopy.discard }));

    await waitFor(() => expect(screen.queryByText("Travel")).not.toBeInTheDocument());
  });

  it("keeps category changes in a draft and submits them atomically", async () => {
    const { onSaveCategories } = renderSection();

    fireEvent.click(await screen.findByRole("button", { name: settingsCopy.manageCategories }));
    fireEvent.change(screen.getByLabelText(settingsCopy.newCategoryPlaceholder), {
      target: { value: "Travel" },
    });
    fireEvent.click(screen.getByRole("button", { name: settingsCopy.addCategory }));

    expect(onSaveCategories).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: commonCopy.save }));
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

    fireEvent.click(await screen.findByRole("button", { name: settingsCopy.switchPreset }));

    // "Meals" is not a category in either preset, so nothing is preselected and
    // the switch cannot be confirmed until the user picks a destination.
    const apply = await screen.findByRole("button", { name: settingsCopy.presetApply });
    expect(apply).toBeDisabled();
    expect(screen.getByText(settingsCopy.presetSummaryNone)).toBeTruthy();

    fireEvent.click(
      screen.getByRole("radio", { name: new RegExp(settingsCopy.presetOptionConcise) })
    );
    fireEvent.click(screen.getByRole("combobox", { name: "Meals" }));
    fireEvent.click(await screen.findByRole("option", { name: /吃喝/ }));

    await waitFor(() => expect(apply).toBeEnabled());
    fireEvent.click(apply);
    // The confirm step is a second dialog with its own equally labelled button.
    const confirmButtons = await screen.findAllByRole("button", { name: settingsCopy.presetApply });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]!);

    await waitFor(() => expect(applyPresetAction).toHaveBeenCalledOnce());
    expect(applyPresetAction).toHaveBeenCalledWith({
      expectedRevision: expect.stringMatching(/^[0-9a-f]{64}$/),
      presetId: "concise",
      mappings: [{ fromCategoryId: "category-1", toPresetIndex: 0 }],
    });
  });

  it("holds 未分类 in the last slot with nothing to press", async () => {
    renderSection({ uncategorizedCount: 2 });

    const row = await screen.findByTestId("uncategorized-row");
    expect(row).toHaveTextContent(settingsCopy.uncategorized);
    expect(row).toHaveTextContent(settingsCopy.categoryItemCount({ count: 2 }));

    // Below the last category, and out of reach of the editor: managing the
    // list adds no control to it, because there is no category behind it.
    const list = row.parentElement!;
    expect(list.lastElementChild).toBe(row);

    fireEvent.click(screen.getByRole("button", { name: settingsCopy.manageCategories }));

    expect(screen.getByTestId("uncategorized-row")).toBe(list.lastElementChild);
    expect(within(row).queryAllByRole("button")).toHaveLength(0);
  });
});
