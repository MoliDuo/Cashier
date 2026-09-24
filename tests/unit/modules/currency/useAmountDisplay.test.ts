import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAmountDisplay } from "@/modules/currency/hooks/useAmountDisplay";

const mockUseConvertedAmount = vi.hoisted(() => vi.fn());

vi.mock("@/modules/currency/hooks/useConvertedAmount", () => ({
  useConvertedAmount: mockUseConvertedAmount,
}));

describe("useAmountDisplay", () => {
  beforeEach(() => {
    mockUseConvertedAmount.mockReset();
    mockUseConvertedAmount.mockReturnValue({
      status: "success",
      converted: "42",
    });
  });

  it("uses converted value for different currencies and forwards date", () => {
    const result = useAmountDisplay({
      amount: "100",
      currency: "CNY",
      mainCurrency: "USD",
      date: "2026-03-20",
    });

    expect(mockUseConvertedAmount).toHaveBeenCalledWith("100", "CNY", "USD", "2026-03-20", {
      enabled: true,
    });
    expect(result).toEqual({
      converted: "42",
      displayAmount: "42",
      isDifferentCurrency: true,
      status: "success",
      isLoading: false,
      isError: false,
      originalCurrency: "CNY",
      mainCurrency: "USD",
    });
  });

  it("uses the persisted converted amount and skips the live query", () => {
    const result = useAmountDisplay({
      amount: "100",
      currency: "CNY",
      mainCurrency: "USD",
      date: "2026-03-20",
      persistedConvertedAmount: "13.33",
    });

    expect(result).toEqual({
      converted: "13.33",
      displayAmount: "13.33",
      isDifferentCurrency: true,
      status: "success",
      isLoading: false,
      isError: false,
      originalCurrency: "CNY",
      mainCurrency: "USD",
    });
    expect(mockUseConvertedAmount).toHaveBeenCalledWith("100", "CNY", "USD", "2026-03-20", {
      enabled: false,
    });
  });

  it("ignores an invalid persisted value and uses live conversion", () => {
    useAmountDisplay({
      amount: "9007199254740993.12",
      currency: "CNY",
      mainCurrency: "USD",
      persistedConvertedAmount: "12oops",
    });

    expect(mockUseConvertedAmount).toHaveBeenCalledWith(
      "9007199254740993.12",
      "CNY",
      "USD",
      undefined,
      { enabled: true }
    );
  });

  it("shows the original amount while conversion is loading", () => {
    mockUseConvertedAmount.mockReturnValue({ status: "loading", converted: null });

    const result = useAmountDisplay({
      amount: "100",
      currency: "CNY",
      mainCurrency: "USD",
    });

    expect(result).toEqual({
      converted: null,
      displayAmount: "100",
      isDifferentCurrency: true,
      status: "loading",
      isLoading: true,
      isError: false,
      originalCurrency: "CNY",
      mainCurrency: "USD",
    });
  });

  it("shows the original amount after conversion failure", () => {
    mockUseConvertedAmount.mockReturnValue({
      status: "error",
      converted: null,
      error: new Error("rates unavailable"),
    });

    const result = useAmountDisplay({
      amount: "100",
      currency: "CNY",
      mainCurrency: "USD",
    });

    expect(result).toMatchObject({
      converted: null,
      displayAmount: "100",
      isDifferentCurrency: true,
      status: "error",
      isLoading: false,
      isError: true,
      originalCurrency: "CNY",
    });
  });

  it("keeps original amount when currencies are equal", () => {
    const result = useAmountDisplay({
      amount: "88",
      currency: "USD",
      mainCurrency: "USD",
    });

    expect(result.displayAmount).toBe("88");
    expect(result.isDifferentCurrency).toBe(false);
    expect(result.originalCurrency).toBe("USD");
  });

  it("does not treat unknown or null currency as different", () => {
    const unknown = useAmountDisplay({
      amount: "50",
      currency: "unknown",
      mainCurrency: "USD",
    });
    const missing = useAmountDisplay({
      amount: "50",
      currency: null,
      mainCurrency: "USD",
    });

    expect(unknown.isDifferentCurrency).toBe(false);
    expect(unknown.displayAmount).toBe("50");
    expect(unknown.status).toBe("idle");
    expect(unknown.originalCurrency).toBe("unknown");

    expect(missing.isDifferentCurrency).toBe(false);
    expect(missing.displayAmount).toBe("50");
    expect(missing.status).toBe("idle");
    expect(missing.originalCurrency).toBe("?");
  });

  it("does not convert when the target currency is unsupported", () => {
    const result = useAmountDisplay({
      amount: "50",
      currency: "USD",
      mainCurrency: "unknown",
    });

    expect(result.isDifferentCurrency).toBe(false);
    expect(result.originalCurrency).toBe("USD");
    expect(result.displayAmount).toBe("50");
  });
});
