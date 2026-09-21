import { describe, it, expect, afterEach, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { expectTextRole } from "tests/helpers/class-tables";
import { DateFilter } from "@/components/ui/date-filter";

vi.mock("next-intl", () => ({
  // The calendar behind the picker reads its weekday row with `raw`.
  useTranslations: () =>
    Object.assign((key: string) => key, {
      raw: () => ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"],
    }),
  useLocale: () => "zh-CN",
}));

describe("DateFilter", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("names today and yesterday rather than spelling the date out", () => {
    // Local noon, so the assertion holds in any runtime timezone.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 11, 12));

    render(<DateFilter value="2026-09-11" onChange={() => {}} readOnly />);

    expect(screen.getByText("today")).toBeInTheDocument();
  });

  it("renders a date-only string without shifting it to the previous day", () => {
    render(<DateFilter value="2026-07-28" onChange={() => {}} />);

    expect(screen.getByText("2026年7月28日 星期二")).toBeInTheDocument();
  });

  it("uses a real button to clear without opening the calendar", () => {
    const onChange = vi.fn();
    render(<DateFilter value="2026-07-28" onChange={onChange} />);

    const clear = screen.getByRole("button", { name: "clear" });
    expect(clear).toHaveAttribute("type", "button");
    fireEvent.click(clear);

    expect(onChange).toHaveBeenCalledWith(null);
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  });

  it("does not render a clear button when disabled, even with a value selected", () => {
    // Regression: a disabled DateFilter (e.g. a read-only detail view)
    // previously still rendered the X button, just visually greyed out and
    // non-functional, instead of omitting it entirely.
    render(<DateFilter value="2026-07-28" onChange={() => {}} disabled />);

    expect(screen.queryByRole("button", { name: "clear" })).not.toBeInTheDocument();
  });

  it("renders plain text without picker chrome when read-only", () => {
    // Regression: read-only surfaces used to pass `disabled`, which still
    // painted the outline button, calendar icon, and dropdown chevron.
    render(<DateFilter value="2026-07-28" onChange={() => {}} readOnly />);

    expect(screen.getByText("2026年7月28日 星期二")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("writes the read-only value as body text even when size is sm", () => {
    // Regression: the static read-only text inherited the interactive `sm`
    // size and rendered a tier smaller than the row around it. It takes the
    // shared body role now, so `sm` cannot reach it at all.
    render(<DateFilter value="2026-07-28" onChange={() => {}} readOnly size="sm" />);

    expectTextRole(screen.getByText("2026年7月28日 星期二"), "body");
  });

  it("does not open a calendar when the read-only value is clicked", () => {
    const onChange = vi.fn();
    render(<DateFilter value="2026-07-28" onChange={onChange} readOnly />);

    fireEvent.click(screen.getByText("2026年7月28日 星期二"));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  });

  it("can drop the calendar marker and restyle the read-only value", () => {
    const { container } = render(
      <DateFilter
        value="2026-07-28"
        onChange={() => {}}
        readOnly
        hideReadOnlyIcon
        readOnlyTextClassName="caller-supplied"
      />
    );

    expect(container.querySelector(".lucide-calendar")).not.toBeInTheDocument();
    // What the caller asks for reaches the value, and the role it sits in is
    // still applied underneath: restyling is an addition, not a replacement.
    const value = screen.getByText("2026年7月28日 星期二");
    expect(value).toHaveClass("caller-supplied");
    expectTextRole(value, "body");
  });

  it("falls back to the interactive picker when read-only has no value", () => {
    render(<DateFilter value={null} onChange={() => {}} readOnly />);

    expect(screen.getByRole("button", { name: "selectDate" })).toBeInTheDocument();
  });

  it("offers the calendar's clear shortcut unless the field says otherwise", () => {
    const { unmount } = render(<DateFilter value="2026-07-28" onChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "2026年7月28日 星期二" }));
    expect(screen.getByText("clear")).toBeInTheDocument();
    unmount();

    // A field that can never be empty hides both clear affordances.
    render(
      <DateFilter
        value="2026-07-28"
        onChange={() => {}}
        showClear={false}
        showClearShortcut={false}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "2026年7月28日 星期二" }));
    expect(screen.getByText("today")).toBeInTheDocument();
    expect(screen.queryByText("clear")).not.toBeInTheDocument();
  });

  it("names today against the ledger timezone, not the device's", () => {
    // Same instant as the timezone test in the date-suggestion suite: at noon
    // UTC it is already the 10th in Kiritimati, so the 9th reads as yesterday.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-09T12:00:00.000Z"));

    render(
      <DateFilter value="2026-09-09" onChange={() => {}} readOnly timeZone="Pacific/Kiritimati" />
    );

    expect(screen.getByText("yesterday")).toBeInTheDocument();
  });
});
