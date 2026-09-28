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

const getEnhancedStatsInputSchema = z
  .object({
    bookId: z.string().regex(UUID_REGEX, "Invalid book").optional(),
    queryRange: dateRangeSchema,
    compareRange: dateRangeSchema,
    /** Optional semantic label for the comparison window. */
    comparisonMode: z.enum(["same_period", "full_period"]).optional(),
    /** The period's own last day; later than `queryRange.to` while it runs. */
    periodEnd: dateStringSchema.optional(),
    /** The comparison period's own last day, which its chart reads on to. */
    previousWholeTo: dateStringSchema.optional(),
  })
  .refine(({ queryRange, periodEnd }) => periodEnd == null || periodEnd >= queryRange.to, {
    message: "The period cannot end before the days it covers",
    path: ["periodEnd"],
  })
  .refine(
    ({ compareRange, previousWholeTo }) =>
      previousWholeTo == null || previousWholeTo >= compareRange.to,
    {
      message: "The previous period cannot end before its compared days",
      path: ["previousWholeTo"],
    }
  );

export type GetEnhancedStatsInput = z.infer<typeof getEnhancedStatsInputSchema>;

export function parseEnhancedStatsInput(input: unknown): GetEnhancedStatsInput {
  const result = getEnhancedStatsInputSchema.safeParse(input);
  if (!result.success) {
    throw new ValidationError("Validation failed", { issues: result.error.issues });
  }

  const { queryRange, compareRange, periodEnd, previousWholeTo } = result.data;
  const toEpochDay = (value: string) => Date.parse(`${value}T00:00:00.000Z`) / 86_400_000;
  const days = (from: string, to: string) => toEpochDay(to) - toEpochDay(from) + 1;
  // The previous period is read whole, so it is whole where it must not reach
  // into the current one.
  const previousTo = previousWholeTo ?? compareRange.to;
  const rangesOverlap =
    queryRange.from <= previousTo && compareRange.from <= (periodEnd ?? queryRange.to);
  if (
    days(queryRange.from, periodEnd ?? queryRange.to) > 3660 ||
    days(compareRange.from, previousTo) > 3660 ||
    rangesOverlap
  ) {
    throw new AppError(
      "Stats ranges must be disjoint and no longer than 3660 days",
      "STATS_RANGE_TOO_LARGE",
      422
    );
  }

  return result.data;
}
