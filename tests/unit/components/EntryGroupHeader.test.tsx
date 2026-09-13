import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EntryGroupHeader } from "@/components/EntryGroupHeader";

describe("EntryGroupHeader", () => {
  it("writes the day as content, not as a muted caption", () => {
    render(<EntryGroupHeader title="今天" totalLabel="¥205.93" />);

    const title = screen.getByRole("heading", { name: "今天" });
    // 14px at the entry name's colour and weight — the band used to be the 12px
    // `meta` grey, which made a day label read like a hint.
    expect(title).toHaveClass("text-sm", "font-medium", "text-text");
    expect(title).not.toHaveClass("text-xs", "text-muted-foreground");
  });

  it("paints the day's total like every other amount, one size down", () => {
    render(<EntryGroupHeader title="今天" totalLabel="¥205.93" />);

    const total = screen.getByText("¥205.93");
    // A sum of the amounts below it: same colour and weight as an entry amount,
    // smaller so it stays quieter than the cards it heads.
    expect(total).toHaveClass("text-sm", "font-semibold", "text-text", "tabular-nums");
    expect(total).not.toHaveClass("text-muted-foreground");
  });

  it("draws the rule at the cards' own border colour", () => {
    const { container } = render(<EntryGroupHeader title="今天" totalLabel="¥205.93" />);

    expect(container.firstElementChild).toHaveClass("border-border");
    expect(container.firstElementChild).not.toHaveClass("border-border/80");
  });

  it("keeps the band when a group has no total to show", () => {
    const { container } = render(<EntryGroupHeader title="日期未知" />);

    expect(screen.getByRole("heading", { name: "日期未知" })).toBeInTheDocument();
    expect(container.querySelectorAll("span")).toHaveLength(0);
  });
});
