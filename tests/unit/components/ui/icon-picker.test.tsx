import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IconPicker } from "@/components/ui/icon-picker";

describe("IconPicker", () => {
  it("uses localized accessible names for the trigger, list, and options", () => {
    const onChange = vi.fn();
    render(<IconPicker value="Coffee" onChange={onChange} />);

    const trigger = screen.getByRole("combobox", { name: "已选择图标：咖啡" });
    fireEvent.click(trigger);

    expect(screen.getByRole("listbox", { name: "图标" })).toBeInTheDocument();
    const option = screen.getByRole("option", { name: "咖啡" });
    expect(option).toHaveAttribute("title", "咖啡");
    expect(option).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("option", { name: "公交" }));
    expect(onChange).toHaveBeenCalledWith("Bus");
  });

  it("keeps historical icon values readable", () => {
    render(<IconPicker value="LegacySpark" onChange={vi.fn()} />);

    expect(screen.getByRole("combobox", { name: "已选择图标：LegacySpark" })).toBeInTheDocument();
  });

  it("announces the unselected trigger", () => {
    render(<IconPicker value={null} onChange={vi.fn()} />);

    expect(screen.getByRole("combobox", { name: "选择图标" })).toBeInTheDocument();
  });
});
