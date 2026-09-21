import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SelectableCardSurface } from "@/components/selectable-card-surface";

describe("SelectableCardSurface", () => {
  it("freezes its content and exposes one full-card checkbox interaction", async () => {
    const user = userEvent.setup();
    const onToggleSelection = vi.fn();
    const onInternalClick = vi.fn();

    render(
      <SelectableCardSurface
        selectionMode
        selected={false}
        selectionLabel="Select lunch"
        onToggleSelection={onToggleSelection}
      >
        <button type="button" onClick={onInternalClick}>
          Edit lunch
        </button>
      </SelectableCardSurface>
    );

    const overlay = screen.getByRole("checkbox", { name: "Select lunch" });
    const content = screen.getByRole("button", { name: "Edit lunch", hidden: true }).parentElement;

    expect(overlay).toHaveAttribute("aria-checked", "false");
    expect(content).toHaveAttribute("inert");
    await user.click(overlay);
    expect(onToggleSelection).toHaveBeenCalledTimes(1);
    expect(onInternalClick).not.toHaveBeenCalled();

    overlay.focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onToggleSelection).toHaveBeenCalledTimes(3);
  });

  it("restores the original content interaction after selection mode exits", async () => {
    const user = userEvent.setup();
    const onInternalClick = vi.fn();
    const { rerender } = render(
      <SelectableCardSurface
        selectionMode
        selected
        selectionLabel="Select lunch"
        onToggleSelection={vi.fn()}
      >
        <button type="button" onClick={onInternalClick}>
          Edit lunch
        </button>
      </SelectableCardSurface>
    );

    rerender(
      <SelectableCardSurface
        selectionMode={false}
        selected={false}
        selectionLabel="Select lunch"
        onToggleSelection={vi.fn()}
      >
        <button type="button" onClick={onInternalClick}>
          Edit lunch
        </button>
      </SelectableCardSurface>
    );

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Edit lunch" });
    expect(button.parentElement).not.toHaveAttribute("inert");
    await user.click(button);
    expect(onInternalClick).toHaveBeenCalledTimes(1);
  });

  it("marks a selected card with the outline alone, never with a box to tick", () => {
    const { container, rerender } = render(
      <SelectableCardSurface
        selectionMode
        selected={false}
        selectionLabel="Select lunch"
        onToggleSelection={vi.fn()}
      >
        <div>Lunch</div>
      </SelectableCardSurface>
    );

    // Nothing decorative is drawn over the card's content: the card itself is
    // what says whether it is in, and it says so where assistive tech reads it.
    expect(container.querySelector("[aria-hidden='true']")).toBeNull();
    expect(container.querySelector('[data-selection-mode="true"]')).toHaveAttribute(
      "data-selected",
      "false"
    );
    expect(screen.getByRole("checkbox", { name: "Select lunch" })).toHaveAttribute(
      "aria-checked",
      "false"
    );

    rerender(
      <SelectableCardSurface
        selectionMode
        selected
        selectionLabel="Select lunch"
        onToggleSelection={vi.fn()}
      >
        <div>Lunch</div>
      </SelectableCardSurface>
    );

    expect(container.querySelector("[aria-hidden='true']")).toBeNull();
    expect(container.querySelector('[data-selected="true"]')).not.toBeNull();
    expect(screen.getByRole("checkbox", { name: "Select lunch" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
  });

  it("disables an unselected card when the selection limit is reached", async () => {
    const user = userEvent.setup();
    const onToggleSelection = vi.fn();
    render(
      <SelectableCardSurface
        selectionMode
        selected={false}
        disabled
        selectionLabel="Select lunch"
        onToggleSelection={onToggleSelection}
      >
        <div>Lunch</div>
      </SelectableCardSurface>
    );

    const overlay = screen.getByRole("checkbox", { name: "Select lunch" });
    expect(overlay).toBeDisabled();
    await user.click(overlay);
    expect(onToggleSelection).not.toHaveBeenCalled();
  });
});
