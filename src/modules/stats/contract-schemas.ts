import { z } from "zod";
import { AppError, ValidationError } from "@/lib/errors";
import { dateStringSchema, UUID_REGEX } from "@/lib/validation";

const dateRangeSchema = z
  .object({
    from: dateStringSchema,
    to: dateStringSchema,
  })
  .refine(({ from, to }) => from <= to, {
    message: "Invalid date range",
    path: ["to"],
  });

const getEnhancedStatsInputSchema = z.object({
  ledgerId: z.string().regex(UUID_REGEX, "Invalid ledgerId"),
  attributedUserId: z.string().regex(UUID_REGEX, "Invalid member").optional(),
  queryRange: dateRangeSchema,
  compareRange: dateRangeSchema,
  /** Optional semantic label for the comparison window. */
  comparisonMode: z.enum(["same_period", "full_period"]).optional(),
});

export type GetEnhancedStatsInput = z.infer<typeof getEnhancedStatsInputSchema>;

export function parseEnhancedStatsInput(input: unknown): GetEnhancedStatsInput {
  const result = getEnhancedStatsInputSchema.safeParse(input);
  if (!result.success) {
    throw new ValidationError("Validation failed", { issues: result.error.issues });
  }

  const toEpochDay = (value: string) => Date.parse(`${value}T00:00:00.000Z`) / 86_400_000;
  const queryDays = toEpochDay(result.data.queryRange.to) - toEpochDay(result.data.queryRange.from);
  const compareDays =
    toEpochDay(result.data.compareRange.to) - toEpochDay(result.data.compareRange.from);
  const rangesOverlap =
    result.data.queryRange.from <= result.data.compareRange.to &&
    result.data.compareRange.from <= result.data.queryRange.to;
  if (queryDays + 1 > 3660 || compareDays + 1 > 3660 || rangesOverlap) {
    throw new AppError(
      "Stats ranges must be disjoint and no longer than 3660 days",
      "STATS_RANGE_TOO_LARGE",
      422
    );
  }

  return result.data;
}
