import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Calendar } from "@/components/ui/calendar";

vi.mock("next-intl", () => ({
  useTranslations: () =>
    Object.assign(
      (key: string, values?: Record<string, string>) =>
        key === "dateFormat" ? `${values?.year}-${values?.month}` : key,
      { raw: () => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] }
    ),
}));

describe("Calendar", () => {
  it("changes months and resets the view when the controlled value changes", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <Calendar value={new Date(2026, 0, 15)} onChange={onChange} showShortcuts={false} />
    );

    expect(screen.getByText("2026-1")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button")[1]!);
    expect(screen.getByText("2026-2")).toBeInTheDocument();

    rerender(<Calendar value={new Date(2026, 2, 20)} onChange={onChange} showShortcuts={false} />);
    expect(screen.getByText("2026-3")).toBeInTheDocument();
  });

  it("uses the standard grid keyboard model and selects with Enter", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <Calendar value={new Date(2026, 0, 15)} onChange={onChange} showShortcuts={false} />
    );
    const selected = container.querySelector<HTMLButtonElement>(
      '[data-calendar-date="2026-01-15"]'
    );
    expect(selected).not.toBeNull();

    selected?.focus();
    fireEvent.keyDown(selected!, { key: "ArrowRight" });

    await waitFor(() =>
      expect(document.activeElement).toHaveAttribute("data-calendar-date", "2026-01-16")
    );
    fireEvent.keyDown(document.activeElement!, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(new Date(2026, 0, 16));
  });

  it("disables today and yesterday shortcuts outside the allowed range", () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    render(<Calendar value={null} onChange={() => {}} minDate={tomorrow} />);

    expect(screen.getByRole("button", { name: "today" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "yesterday" })).toBeDisabled();
  });

  it("delegates Escape so the owning popover can restore focus", () => {
    const onEscape = vi.fn();
    const { container } = render(
      <Calendar
        value={new Date(2026, 0, 15)}
        onChange={() => {}}
        onEscape={onEscape}
        showShortcuts={false}
      />
    );
    const selected = container.querySelector<HTMLButtonElement>(
      '[data-calendar-date="2026-01-15"]'
    );
    fireEvent.keyDown(selected!, { key: "Escape" });
    expect(onEscape).toHaveBeenCalledOnce();
  });
});
