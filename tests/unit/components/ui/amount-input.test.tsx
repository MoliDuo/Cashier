import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AmountInput } from "@/components/ui/amount-input";

describe("AmountInput", () => {
  it("accepts a negative decimal when enabled", () => {
    const onChange = vi.fn();
    render(<AmountInput value="" onChange={onChange} allowNegative aria-label="amount" />);

    fireEvent.change(screen.getByRole("textbox", { name: "amount" }), {
      target: { value: "-8.25" },
    });

    expect(onChange).toHaveBeenCalledWith("-8.25");
  });

  it("keeps the default input unsigned", () => {
    const onChange = vi.fn();
    render(<AmountInput value="" onChange={onChange} aria-label="amount" />);

    fireEvent.change(screen.getByRole("textbox", { name: "amount" }), {
      target: { value: "-8.25" },
    });

    expect(onChange).not.toHaveBeenCalled();
  });
});
