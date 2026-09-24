import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AmountDisplay } from "@/modules/currency/ui/AmountDisplay";

const mockUseAmountDisplay = vi.hoisted(() => vi.fn());

vi.mock("@/modules/currency/hooks/useAmountDisplay", () => ({
  useAmountDisplay: mockUseAmountDisplay,
}));

function renderAmountDisplay(props: Partial<React.ComponentProps<typeof AmountDisplay>> = {}) {
  return render(
    <NextIntlClientProvider
      locale="zh"
      messages={{
        Currency: {
          conversionUnavailable: "暂时无法换算",
        },
      }}
    >
      <AmountDisplay amount="100" currency="CNY" mainCurrency="USD" {...props} />
    </NextIntlClientProvider>
  );
}

describe("AmountDisplay", () => {
  beforeEach(() => {
    mockUseAmountDisplay.mockReset();
  });

  it("shows same-currency amounts with a narrow symbol and live-region semantics", () => {
    mockUseAmountDisplay.mockReturnValue({
      displayAmount: "100",
      isDifferentCurrency: false,
      originalCurrency: "USD",
      status: "idle",
    });
    const { container } = renderAmountDisplay({ currency: "USD" });

    expect(screen.getByText(/\$100\.00/)).toBeInTheDocument();
    expect(container.firstChild).toHaveAttribute("aria-live", "polite");
    expect(container.firstChild).toHaveAttribute("aria-atomic", "true");
  });

  it.each(["loading", "idle"] as const)("shows original currency code while %s", (status) => {
    mockUseAmountDisplay.mockReturnValue({
      displayAmount: "100",
      isDifferentCurrency: true,
      originalCurrency: "CNY",
      status,
    });
    const { container } = renderAmountDisplay();

    expect(screen.getByText(/CNY\s*100\.00/)).toBeInTheDocument();
    if (status === "loading") expect(container.firstChild).toHaveAttribute("aria-busy", "true");
    else expect(container.firstChild).not.toHaveAttribute("aria-busy");
  });

  it("shows converted and original amounts on success", () => {
    mockUseAmountDisplay.mockReturnValue({
      displayAmount: "13.33",
      isDifferentCurrency: true,
      originalCurrency: "CNY",
      status: "success",
    });
    renderAmountDisplay();

    expect(screen.getByText(/\$13\.33/)).toBeInTheDocument();
    expect(screen.getByText(/CNY\s*100\.00/)).toBeInTheDocument();
  });

  it("shows negative amounts without any extra label", () => {
    mockUseAmountDisplay.mockReturnValue({
      displayAmount: "-8",
      isDifferentCurrency: false,
      originalCurrency: "CNY",
      status: "idle",
    });
    const { container } = renderAmountDisplay({ amount: "-8" });

    expect(screen.getByText(/-.*8\.00/)).toBeInTheDocument();
    // Negative amounts used to carry an "expense deduction" caption; it is gone.
    expect(container.textContent).toBe("-¥8.00");
  });

  it("can hide the original amount on success", () => {
    mockUseAmountDisplay.mockReturnValue({
      displayAmount: "13.33",
      isDifferentCurrency: true,
      originalCurrency: "CNY",
      status: "success",
    });
    renderAmountDisplay({ showOriginal: false });

    expect(screen.queryByText(/CNY\s*100\.00/)).not.toBeInTheDocument();
  });

  it("shows the original amount and unavailable message on error", () => {
    mockUseAmountDisplay.mockReturnValue({
      displayAmount: "100",
      isDifferentCurrency: true,
      originalCurrency: "CNY",
      status: "error",
    });
    renderAmountDisplay();

    expect(screen.getByText(/CNY\s*100\.00/)).toBeInTheDocument();
    expect(screen.getByText("暂时无法换算")).toBeInTheDocument();
  });

  it("keeps large persisted decimals intact in the DOM", () => {
    mockUseAmountDisplay.mockReturnValue({
      displayAmount: "9007199254740993.12",
      isDifferentCurrency: false,
      originalCurrency: "USD",
      status: "idle",
    });
    renderAmountDisplay({ amount: "9007199254740993.12", currency: "USD" });

    expect(screen.getByText(/9,007,199,254,740,993\.12/)).toBeInTheDocument();
  });

  it("does not relabel the amount for an unknown target", () => {
    mockUseAmountDisplay.mockReturnValue({
      displayAmount: "100",
      isDifferentCurrency: false,
      originalCurrency: "USD",
      status: "idle",
    });
    renderAmountDisplay({ currency: "USD", mainCurrency: "unknown" });

    expect(screen.getByText(/\$100\.00/)).toBeInTheDocument();
  });
});
