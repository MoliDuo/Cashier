"use client";

import { useConvertedAmount } from "./useConvertedAmount";
import { SUPPORTED_CURRENCIES } from "@/config/currencies";
import { isValidDecimal } from "@/lib/money/decimal";

interface UseAmountDisplayOptions {
  amount: string;
  currency: string | null | undefined;
  mainCurrency: string;
  date?: string | null;
  /**
   * Persisted accounting amount (authoritative for read-only entries). When
   * present for a different currency, the live conversion query is skipped.
   */
  persistedConvertedAmount?: string | null;
}

type UseAmountDisplayStatus = "idle" | "loading" | "success" | "error";

const supportedCurrencySet = new Set<string>(SUPPORTED_CURRENCIES);

interface UseAmountDisplayReturn {
  /** The converted amount, or null while loading/errored */
  converted: string | null;
  /** The amount to display (converted if different currency) */
  displayAmount: string;
  /** Whether the currency is different from main currency */
  isDifferentCurrency: boolean;
  status: UseAmountDisplayStatus;
  /** Whether the conversion is loading */
  isLoading: boolean;
  isError: boolean;
  /** The original currency code */
  originalCurrency: string;
  /** The main currency code */
  mainCurrency: string;
}

/**
 * Hook for displaying amounts with currency conversion.
 * Handles conversion logic and currency difference detection.
 */
export function useAmountDisplay({
  amount,
  currency,
  mainCurrency,
  date,
  persistedConvertedAmount,
}: UseAmountDisplayOptions): UseAmountDisplayReturn {
  const validOriginalCurrency = currency != null && supportedCurrencySet.has(currency);
  const validMainCurrency = supportedCurrencySet.has(mainCurrency);
  const isDifferentCurrency =
    validOriginalCurrency && validMainCurrency && currency !== mainCurrency;
  const hasPersistedConvertedAmount =
    persistedConvertedAmount != null && isValidDecimal(persistedConvertedAmount);
  const usePersisted = isDifferentCurrency && hasPersistedConvertedAmount;

  const conversion = useConvertedAmount(amount, currency, mainCurrency, date, {
    enabled: !usePersisted,
  });
  const originalCurrency = currency ?? "?";

  if (usePersisted) {
    const converted = persistedConvertedAmount!;
    return {
      converted,
      displayAmount: converted,
      isDifferentCurrency: true,
      status: "success",
      isLoading: false,
      isError: false,
      originalCurrency,
      mainCurrency,
    };
  }

  if (!isDifferentCurrency) {
    return {
      converted: amount,
      displayAmount: amount,
      isDifferentCurrency: false,
      status: "idle",
      isLoading: false,
      isError: false,
      originalCurrency,
      mainCurrency,
    };
  }

  switch (conversion.status) {
    case "idle":
      return {
        converted: amount,
        displayAmount: amount,
        isDifferentCurrency: true,
        status: "idle",
        isLoading: false,
        isError: false,
        originalCurrency,
        mainCurrency,
      };
    case "loading":
      return {
        converted: null,
        displayAmount: amount,
        isDifferentCurrency: true,
        status: "loading",
        isLoading: true,
        isError: false,
        originalCurrency,
        mainCurrency,
      };
    case "error":
      return {
        converted: null,
        displayAmount: amount,
        isDifferentCurrency: true,
        status: "error",
        isLoading: false,
        isError: true,
        originalCurrency,
        mainCurrency,
      };
    case "success":
      return {
        converted: conversion.converted,
        displayAmount: conversion.converted,
        isDifferentCurrency: true,
        status: "success",
        isLoading: false,
        isError: false,
        originalCurrency,
        mainCurrency,
      };
  }

  throw new Error("Unreachable useAmountDisplay state");
}
