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

  it("paints the day's total as the app's ordinary amount", () => {
    render(<EntryGroupHeader title="今天" totalLabel="¥205.93" />);

    const total = screen.getByText("¥205.93");
    // A sum of the amounts below it, written the same way they are: same size,
    // weight and colour, so a day's figure is not a smaller variant of them.
    expect(total).toHaveClass("text-base", "font-semibold", "text-text", "tabular-nums");
    expect(total).not.toHaveClass("text-sm", "text-muted-foreground");
  });

  it("draws the rule at the cards' own border colour, inset to the card's width", () => {
    const { container } = render(<EntryGroupHeader title="今天" totalLabel="¥205.93" />);

    expect(container.firstElementChild).toHaveClass("border-border", "mx-2");
    expect(container.firstElementChild).not.toHaveClass("border-border/80");
  });

  it("insets the date and the total onto the rows' own columns", () => {
    const { container } = render(<EntryGroupHeader title="今天" totalLabel="¥205.93" />);

    // The band's box is inset like a card, and a row's text starts one `px-3`
    // inside the card's 1px border: 13px is what puts the date over the entry
    // names' column and the total over the entry amounts' column.
    expect(container.firstElementChild).toHaveClass("px-[13px]");
  });

  it("keeps the band when a group has no total to show", () => {
    const { container } = render(<EntryGroupHeader title="日期未知" />);

    expect(screen.getByRole("heading", { name: "日期未知" })).toBeInTheDocument();
    expect(container.querySelectorAll("span")).toHaveLength(0);
  });
});
