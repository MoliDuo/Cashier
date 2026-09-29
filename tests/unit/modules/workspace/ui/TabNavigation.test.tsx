import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TabNavigation } from "@/modules/workspace/ui/TabNavigation";

describe("TabNavigation", () => {
  it("disables every action until the ledger content is ready", () => {
    render(
      <TabNavigation
        variant="bottom"
        disabled
        activeTab="records"
        onTabChange={vi.fn()}
        onOpenInput={vi.fn()}
      />
    );
    for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
  });

  it("puts 记一笔 between the first two tabs and the last two on the bottom bar", async () => {
    const user = userEvent.setup();
    const onTabChange = vi.fn();
    const onOpenInput = vi.fn();

    render(
      <TabNavigation
        variant="bottom"
        activeTab="records"
        onTabChange={onTabChange}
        onOpenInput={onOpenInput}
      />
    );

    expect(screen.getByRole("button", { name: "账目" })).toHaveAttribute("aria-current", "page");
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
      "账目",
      "明细",
      "",
      "统计",
      "设置",
    ]);

    await user.click(screen.getByRole("button", { name: "统计" }));
    expect(onTabChange).toHaveBeenCalledWith("stats");

    await user.click(screen.getByRole("button", { name: "记一笔" }));
    expect(onOpenInput).toHaveBeenCalledOnce();
  });

  it("offers the four tabs in the top bar", () => {
    render(<TabNavigation variant="top" activeTab="stats" onTabChange={vi.fn()} />);

    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual([
      "账目",
      "明细",
      "统计",
      "设置",
    ]);
    expect(screen.getByRole("button", { name: "统计" })).toHaveAttribute("aria-current", "page");
  });

  it("marks 设置 like any other tab when it is the page", () => {
    render(<TabNavigation variant="top" activeTab="settings" onTabChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: "设置" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "账目" })).not.toHaveAttribute("aria-current");
  });

  it("reports a tap on the active destination too; the shell decides it goes nowhere", async () => {
    const user = userEvent.setup();
    const onTabChange = vi.fn();

    render(<TabNavigation variant="top" activeTab="records" onTabChange={onTabChange} />);
    await user.click(screen.getByRole("button", { name: "账目" }));

    expect(onTabChange).toHaveBeenCalledWith("records");
  });

  it("calls onTabIntent on pointer enter and focus for inactive destinations only", async () => {
    const user = userEvent.setup();
    const onTabIntent = vi.fn();

    render(
      <TabNavigation
        variant="top"
        activeTab="records"
        onTabChange={vi.fn()}
        onTabIntent={onTabIntent}
      />
    );

    await user.hover(screen.getByRole("button", { name: "统计" }));
    expect(onTabIntent).toHaveBeenCalledWith("stats");
    await user.hover(screen.getByRole("button", { name: "账目" }));
    expect(onTabIntent).not.toHaveBeenCalledWith("records");
  });
});
