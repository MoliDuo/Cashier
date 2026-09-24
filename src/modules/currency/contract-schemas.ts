import { z } from "zod";
import { ValidationError } from "@/lib/errors";
import { optionalDateStringSchema } from "@/lib/validation";
import { SUPPORTED_CURRENCIES } from "@/config/currencies";
import { isValidDecimal, normalize } from "@/lib/money/decimal";

const supportedCurrencySet = new Set<string>(SUPPORTED_CURRENCIES);

/**
 * Normalized currency code: trims, uppercases, and requires a supported
 * currency from the application whitelist.
 */
export const currencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine((code) => supportedCurrencySet.has(code), "Unsupported currency code");

/**
 * Amounts may be positive, negative, or zero so adjustment entries and
 * zero-amount rows can be converted. NaN and Infinity are rejected.
 */
const decimalAmountSchema = z
  .string()
  .refine(isValidDecimal, "Amount must be a valid decimal string")
  .transform(normalize);

const convertCurrencyInputSchema = z.object({
  amount: decimalAmountSchema,
  from: currencyCodeSchema,
  to: currencyCodeSchema,
  date: optionalDateStringSchema,
});

export type ConvertCurrencyInput = z.infer<typeof convertCurrencyInputSchema>;

export function parseConvertCurrencyInput(input: unknown): ConvertCurrencyInput {
  const result = convertCurrencyInputSchema.safeParse(input);
  if (!result.success) {
    throw new ValidationError("Missing required parameters", { issues: result.error.issues });
  }

  return result.data;
}
