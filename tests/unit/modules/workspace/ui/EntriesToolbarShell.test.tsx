import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EntriesToolbarShell } from "@/modules/workspace/ui/EntriesToolbarShell";

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("sonner", () => ({ toast: { error: toastError } }));

describe("EntriesToolbarShell", () => {
  afterEach(() => vi.clearAllMocks());

  it("refreshes the tab when the box itself is clicked", () => {
    const onRefresh = vi.fn();
    render(
      <EntriesToolbarShell onRefresh={onRefresh} totalLabel="¥12.00">
        <span>filters</span>
      </EntriesToolbarShell>
    );

    fireEvent.click(screen.getByText("¥12.00"));

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("leaves the select and filter controls their own gesture", () => {
    const onRefresh = vi.fn();
    render(
      <EntriesToolbarShell onRefresh={onRefresh}>
        <button type="button">select</button>
        <div role="dialog">
          <span>calendar</span>
        </div>
      </EntriesToolbarShell>
    );

    fireEvent.click(screen.getByRole("button", { name: "select" }));
    // Radix portals its popovers, but their events still bubble through the box.
    fireEvent.click(screen.getByRole("dialog"));

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it("refreshes from the hint, so the gesture also works by tap and by keyboard", () => {
    const onRefresh = vi.fn();
    render(<EntriesToolbarShell onRefresh={onRefresh}>{null}</EntriesToolbarShell>);

    fireEvent.click(screen.getByRole("button", { name: "refreshHint" }));

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("spins while a refresh is running rather than naming the wait", () => {
    render(
      <EntriesToolbarShell onRefresh={vi.fn()} isRefreshing>
        {null}
      </EntriesToolbarShell>
    );

    const hint = screen.getByTestId("toolbar-refresh-hint");
    expect(hint.querySelector("svg")).toHaveClass("animate-spin");
    expect(hint).not.toHaveTextContent("refreshHint");
    // The label stays for whoever cannot see the spinner, and keeps the control
    // reachable by its name.
    expect(screen.getByRole("button", { name: "refreshing" })).toBe(hint);
  });

  it("reports a failed refresh and ignores one that is already running", async () => {
    const onRefresh = vi.fn().mockRejectedValue(new Error("offline"));
    const { rerender } = render(
      <EntriesToolbarShell onRefresh={onRefresh}>{null}</EntriesToolbarShell>
    );

    fireEvent.click(screen.getByRole("button", { name: "refreshHint" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("refreshFailed"));

    rerender(
      <EntriesToolbarShell onRefresh={onRefresh} isRefreshing>
        {null}
      </EntriesToolbarShell>
    );
    fireEvent.click(screen.getByRole("button", { name: "refreshing" }));

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("keeps the hint off a box that has no refresh to offer", () => {
    render(<EntriesToolbarShell>filters</EntriesToolbarShell>);

    expect(screen.getByText("filters")).toBeInTheDocument();
    expect(screen.queryByTestId("toolbar-refresh-hint")).not.toBeInTheDocument();
  });
});
