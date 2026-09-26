import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EditableField } from "@/components/ui/editable-field";

describe("EditableField", () => {
  it("starts from the latest value and restores it when editing is cancelled", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <EditableField value="Initial" onChange={onChange} saveOnBlur={false} />
    );

    rerender(<EditableField value="Updated" onChange={onChange} saveOnBlur={false} />);
    fireEvent.click(screen.getByText("Updated"));
    const input = screen.getByRole("textbox");
    expect(input).toHaveValue("Updated");

    fireEvent.change(input, { target: { value: "Draft" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("Updated")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("contains Escape so a parent dialog does not close", () => {
    const parentKeyDown = vi.fn();
    render(
      <div onKeyDown={parentKeyDown}>
        <EditableField value="Initial" onChange={vi.fn()} saveOnBlur={false} />
      </div>
    );

    fireEvent.click(screen.getByText("Initial"));
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });

    expect(parentKeyDown).not.toHaveBeenCalled();
  });

  it("starts editing with Enter and commits a single-line field with Enter", () => {
    const onChange = vi.fn();
    render(<EditableField value="Initial" onChange={onChange} saveOnBlur={false} />);

    fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Updated" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith("Updated");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("keeps textarea Enter as a newline and commits with Ctrl+Enter", () => {
    const onChange = vi.fn();
    render(
      <EditableField value="Initial" onChange={onChange} type="textarea" saveOnBlur={false} />
    );

    fireEvent.keyDown(screen.getByRole("button"), { key: "F2" });
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "Initial\nSecond line" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox")).toBeInTheDocument();

    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });
    expect(onChange).toHaveBeenCalledWith("Initial\nSecond line");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});
