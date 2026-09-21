import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EntryGroupHeader, groupSelectionState } from "@/components/EntryGroupHeader";
import { expectAmountVariant, expectTextRole } from "tests/helpers/class-tables";

describe("EntryGroupHeader", () => {
  it("writes the day as content, not as a muted caption", () => {
    render(<EntryGroupHeader title="今天" totalLabel="¥205.93" />);

    // The band used to be the `meta` grey, which made a day label read like a
    // hint. It takes the entry name's own role now, so the two stay in step
    // whatever that role is retuned to.
    expectTextRole(screen.getByRole("heading", { name: "今天" }), "bodyStrong");
  });

  it("paints the day's total as the app's ordinary amount", () => {
    render(<EntryGroupHeader title="今天" totalLabel="¥205.93" />);

    // A sum of the amounts below it, written the way they are: it takes the
    // same variant rather than a size that happens to match today.
    expectAmountVariant(screen.getByText("¥205.93"), "item");
  });

  it("keeps the band when a group has no total to show", () => {
    const { container } = render(<EntryGroupHeader title="日期未知" />);

    expect(screen.getByRole("heading", { name: "日期未知" })).toBeInTheDocument();
    expect(container.querySelectorAll("span")).toHaveLength(0);
  });

  it("stays plain text until it is given a selection to control", () => {
    render(<EntryGroupHeader title="今天" totalLabel="¥205.93" />);

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("marks a partly selected day as mixed and names the day in its label", () => {
    render(
      <EntryGroupHeader
        title="今天"
        totalLabel="¥205.93"
        selection={{ state: "some", label: "选中今天的全部记录", onToggle: vi.fn() }}
      />
    );

    const control = screen.getByRole("checkbox", { name: "选中今天的全部记录" });
    expect(control).toHaveAttribute("aria-checked", "mixed");
    // The day is still readable behind the control, not hidden from it.
    expect(screen.getByRole("heading", { name: "今天" })).toBeInTheDocument();
  });

  it("takes the whole day on one tap and gives it back on the next", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const { rerender } = render(
      <EntryGroupHeader
        title="今天"
        totalLabel="¥205.93"
        selection={{ state: "none", label: "选中今天的全部记录", onToggle }}
      />
    );

    expect(screen.getByRole("checkbox")).toHaveAttribute("aria-checked", "false");
    await user.click(screen.getByRole("checkbox"));
    expect(onToggle).toHaveBeenCalledOnce();

    rerender(
      <EntryGroupHeader
        title="今天"
        totalLabel="¥205.93"
        selection={{ state: "all", label: "取消选中今天的全部记录", onToggle }}
      />
    );

    const control = screen.getByRole("checkbox", { name: "取消选中今天的全部记录" });
    expect(control).toHaveAttribute("aria-checked", "true");
    await user.click(control);
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it("refuses the day when it cannot be added, rather than only looking refused", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <EntryGroupHeader
        title="今天"
        totalLabel="¥205.93"
        selection={{
          state: "none",
          label: "选中今天的全部记录",
          disabled: true,
          onToggle,
        }}
      />
    );

    const control = screen.getByRole("checkbox");
    expect(control).toBeDisabled();
    // The dimming is how it is drawn; this is what it has to do.
    await user.click(control);
    expect(onToggle).not.toHaveBeenCalled();
  });
});

describe("groupSelectionState", () => {
  it("reads a group as none, some or all of its rows", () => {
    const ids = ["a", "b", "c"];

    expect(groupSelectionState(ids, new Set())).toBe("none");
    expect(groupSelectionState(ids, new Set(["a"]))).toBe("some");
    expect(groupSelectionState(ids, new Set(["a", "b", "c"]))).toBe("all");
  });

  it("ignores ids outside the group", () => {
    expect(groupSelectionState(["a", "b"], new Set(["a", "b", "elsewhere"]))).toBe("all");
  });
});
