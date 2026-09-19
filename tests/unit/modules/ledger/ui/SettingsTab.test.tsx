import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BookkeepingSettings } from "@/modules/ledger/ui/settings/BookkeepingSettings";
import type { ComponentProps } from "react";
import { toast } from "sonner";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
import { getDefaultLedger } from "tests/helpers/default-ledger";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/modules/ledger/ui/CurrencySection", () => ({
  CurrencySection: () => <div>currency-section</div>,
}));

vi.mock("@/modules/ledger/ui/CategorySection", () => ({
  CategorySection: () => <div>category-section</div>,
}));

type BookkeepingProps = ComponentProps<typeof BookkeepingSettings>;

/**
 * 记账规则 owns the AI fields too, so the draft cases render that one section
 * and override only the props the case cares about.
 */
const bookkeepingProps = (overrides: Partial<BookkeepingProps>): BookkeepingProps => ({
  ledgerId: "ledger-1",
  settings: getDefaultLedger().settings,
  categories: [],
  uncategorizedCount: 0,
  onUpdateSettings: () => Promise.reject(new Error("unexpected save")),
  onSaveCategories: () => Promise.resolve([]),
  generatingCategoryIds: new Set(),
  failedCategoryIds: new Set(),
  onRetryMetadata: () => {},
  isSavingCategories: false,
  ...overrides,
});

describe("explicit settings section drafts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps AI changes local until Save and submits only the diff", async () => {
    const onUpdateSettings = vi.fn().mockResolvedValue({
      id: "ledger-1",
      userId: "user-1",
      settings: {
        ...getDefaultLedger().settings,
        aiLanguage: "zh-CN",
        aiCustomPrompt: "Draft prompt",
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    render(
      <BookkeepingSettings
        {...bookkeepingProps({
          settings: {
            ...getDefaultLedger().settings,
            aiLanguage: "zh-CN",
            aiCustomPrompt: "Server prompt",
          },
          onUpdateSettings,
        })}
      />
    );

    const prompt = screen.getByRole("textbox", { name: "aiPrompt" });
    fireEvent.change(prompt, { target: { value: "Draft prompt" } });
    fireEvent.blur(prompt);
    expect(onUpdateSettings).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(onUpdateSettings).toHaveBeenCalledWith({ aiCustomPrompt: "Draft prompt" })
    );
  });

  it("confirms before restoring the AI server snapshot on Cancel", async () => {
    render(
      <BookkeepingSettings
        {...bookkeepingProps({
          settings: {
            ...getDefaultLedger().settings,
            aiLanguage: "zh-CN",
            aiCustomPrompt: "Server prompt",
          },
          onUpdateSettings: () =>
            Promise.resolve({
              id: "ledger-1",
              userId: "user-1",
              settings: { ...getDefaultLedger().settings },
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-01T00:00:00.000Z",
            }),
        })}
      />
    );

    fireEvent.change(screen.getByRole("textbox", { name: "aiPrompt" }), {
      target: { value: "Discard me" },
    });
    fireEvent.click(screen.getByRole("button", { name: "cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "continueEditing" }));
    expect(screen.getByRole("textbox", { name: "aiPrompt" })).toHaveValue("Discard me");
    fireEvent.click(screen.getByRole("button", { name: "cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "discard" }));
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "aiPrompt" })).toHaveValue("Server prompt")
    );
  });

  it("keeps bookkeeping switches as a draft until Save", async () => {
    const onUpdateSettings = vi.fn().mockResolvedValue({
      id: "ledger-1",
      userId: "user-1",
      settings: {
        ...getDefaultLedger().settings,
        mainCurrency: "CNY",
        currencies: ["CNY"],
        collapseEntriesDefault: true,
      },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    render(
      <BookkeepingSettings
        ledgerId="ledger-1"
        settings={{
          ...getDefaultLedger().settings,
          mainCurrency: "CNY",
          currencies: ["CNY"],
          collapseEntriesDefault: false,
        }}
        categories={[]}
        uncategorizedCount={0}
        onUpdateSettings={onUpdateSettings}
        onSaveCategories={() => Promise.resolve([])}
        generatingCategoryIds={new Set()}
        failedCategoryIds={new Set()}
        onRetryMetadata={() => {}}
        isSavingCategories={false}
      />
    );

    fireEvent.click(screen.getByRole("switch", { name: "collapseEntries" }));
    expect(onUpdateSettings).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(onUpdateSettings).toHaveBeenCalledWith({ collapseEntriesDefault: true })
    );
  });

  it("keeps edits without a server-update banner and reports conflict only on Save", () => {
    const onUpdateSettings = vi.fn();
    const { rerender } = render(
      <BookkeepingSettings
        {...bookkeepingProps({
          settings: { ...getDefaultLedger().settings, aiCustomPrompt: "Server prompt" },
          onUpdateSettings,
        })}
      />
    );
    fireEvent.change(screen.getByRole("textbox", { name: "aiPrompt" }), {
      target: { value: "Draft prompt" },
    });
    rerender(
      <BookkeepingSettings
        {...bookkeepingProps({
          settings: { ...getDefaultLedger().settings, aiCustomPrompt: "New server prompt" },
          onUpdateSettings,
        })}
      />
    );
    expect(screen.getByRole("textbox", { name: "aiPrompt" })).toHaveValue("Draft prompt");
    expect(screen.queryByText("serverChangedWhileEditing")).not.toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    expect(toast.error).toHaveBeenCalledWith("updateConflict");
    expect(onUpdateSettings).not.toHaveBeenCalled();
  });
});
