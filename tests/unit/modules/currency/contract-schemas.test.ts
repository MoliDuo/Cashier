import { describe, expect, it } from "vitest";
import { currencyCodeSchema, parseConvertCurrencyInput } from "@/modules/currency/contract-schemas";

describe("currency contract schemas", () => {
  it("parses currency conversion input with the module contract schema", () => {
    expect(parseConvertCurrencyInput({ amount: "12.500", from: "USD", to: "CNY" })).toEqual({
      amount: "12.5",
      from: "USD",
      to: "CNY",
    });
  });

  it("rejects blank conversion parameters before the use case runs", () => {
    expect(() => parseConvertCurrencyInput({ amount: "0", from: "", to: "" })).toThrow(
      "Missing required parameters"
    );
  });

  it("normalizes lowercase and whitespace-padded currency codes", () => {
    expect(currencyCodeSchema.parse(" usd ")).toBe("USD");
    expect(parseConvertCurrencyInput({ amount: "10", from: "cny", to: "usd" })).toEqual({
      amount: "10",
      from: "CNY",
      to: "USD",
    });
  });

  it("rejects unsupported currency codes", () => {
    expect(() => currencyCodeSchema.parse("ZZZ")).toThrow();
    expect(() => parseConvertCurrencyInput({ amount: "10", from: "USD", to: "BTH" })).toThrow(
      "Missing required parameters"
    );
  });

  it("allows positive, negative, and zero amounts for adjustment entries", () => {
    expect(parseConvertCurrencyInput({ amount: "0", from: "USD", to: "CNY" }).amount).toBe("0");
    expect(parseConvertCurrencyInput({ amount: "-12.5", from: "USD", to: "CNY" }).amount).toBe(
      "-12.5"
    );
  });

  it("rejects number, exponent, NaN and Infinity amounts", () => {
    expect(() => parseConvertCurrencyInput({ amount: 12.5, from: "USD", to: "CNY" })).toThrow(
      "Missing required parameters"
    );
    expect(() => parseConvertCurrencyInput({ amount: "1e2", from: "USD", to: "CNY" })).toThrow(
      "Missing required parameters"
    );
    expect(() => parseConvertCurrencyInput({ amount: Number.NaN, from: "USD", to: "CNY" })).toThrow(
      "Missing required parameters"
    );
    expect(() =>
      parseConvertCurrencyInput({ amount: Number.POSITIVE_INFINITY, from: "USD", to: "CNY" })
    ).toThrow("Missing required parameters");
  });

  it("accepts 1000 digits and rejects 1001 digits for conversion input", () => {
    const accepted = `1${"0".repeat(999)}`;
    const rejected = `1${"0".repeat(1000)}`;

    expect(parseConvertCurrencyInput({ amount: accepted, from: "USD", to: "CNY" }).amount).toBe(
      accepted
    );
    expect(() => parseConvertCurrencyInput({ amount: rejected, from: "USD", to: "CNY" })).toThrow();
  });
});
