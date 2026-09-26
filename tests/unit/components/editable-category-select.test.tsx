import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EditableCategorySelect } from "@/components/editable-category-select";

const categories = [
  { id: "cat-food", name: "Food", icon: "Utensils" },
  { id: "cat-travel", name: "Travel", icon: "Plane" },
];

function renderSelect(
  overrides: Partial<React.ComponentProps<typeof EditableCategorySelect>> = {}
) {
  const onChange = vi.fn();
  render(
    <EditableCategorySelect
      value="cat-food"
      categories={categories}
      onChange={onChange}
      placeholder="Select category"
      {...overrides}
    />
  );
  return { onChange };
}

describe("EditableCategorySelect", () => {
  it("shows the category name in the default trigger", () => {
    renderSelect();

    expect(screen.getByRole("combobox")).toHaveTextContent("Food");
  });

  it("shows only the icon when iconOnly and read-only", () => {
    // Regression: the detail list card already prints the category name on the
    // description line, so the pill's icon+name repeated it.
    renderSelect({ iconOnly: true, disabled: true });

    expect(screen.queryByText("Food")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("keeps iconOnly as an interactive dropdown trigger when editable", () => {
    renderSelect({ iconOnly: true });

    const trigger = screen.getByRole("combobox");
    expect(trigger).not.toHaveTextContent("Food");
    // The accessible name still carries the category, since the visible text
    // is only an icon.
    expect(trigger).toHaveAccessibleName("Food");

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: "Travel" }));

    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("names the iconOnly trigger after the placeholder when uncategorized", () => {
    renderSelect({ iconOnly: true, value: null });

    expect(screen.getByRole("combobox")).toHaveAccessibleName("Select category");
  });

  it("toggles the listbox from the iconOnly trigger", () => {
    renderSelect({ iconOnly: true });

    fireEvent.click(screen.getByRole("combobox"));
    expect(screen.getByRole("listbox", { name: "Select category" })).toBeInTheDocument();
  });

  it("backs the iconOnly icon with the 32px circular surface chip", () => {
    renderSelect({ iconOnly: true });

    const chip = document.querySelector(".rounded-full.bg-surface2");
    expect(chip).toBeInTheDocument();
    expect(chip).toHaveClass("h-8", "w-8");
  });

  it("backs the read-only iconOnly icon with the same chip", () => {
    renderSelect({ iconOnly: true, disabled: true });

    const chip = document.querySelector(".rounded-full.bg-surface2");
    expect(chip).toBeInTheDocument();
  });
});
