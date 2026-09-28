import "server-only";
import { getDateInTimezone } from "@/lib/date-utils";
import { ValidationError } from "@/lib/errors";
import { periodInputSchema } from "@/modules/ledger/contract-schemas";
import { resolveComparison, resolvePeriod, type Period } from "@/modules/ledger/domain/period";

/** Today in the ledger's zone: the one day every period is counted from. */
export function ledgerToday(timeZone: string): string {
  return getDateInTimezone(timeZone) ?? getDateInTimezone("UTC")!;
}

function readPeriod(value: unknown): Period {
  const result = periodInputSchema.safeParse(value);
  if (!result.success) {
    throw new ValidationError("Validation failed", { issues: result.error.issues });
  }
  return result.data;
}

function takePeriod(input: unknown): { period: Period; rest: Record<string, unknown> } | null {
  if (input == null || typeof input !== "object" || !("period" in input)) return null;
  const { period, ...rest } = input as Record<string, unknown>;
  return { period: readPeriod(period), rest };
}

/**
 * A list or total read names its days as a period; this turns it into the
 * start and end dates the read filters on, counted from the ledger's today.
 * Input without a period passes through unchanged.
 */
export function withResolvedPeriod(input: unknown, timeZone: string): unknown {
  const taken = takePeriod(input);
  if (taken == null) return input;
  const range = resolvePeriod(taken.period, ledgerToday(timeZone));
  return range == null ? taken.rest : { ...taken.rest, startDate: range.from, endDate: range.to };
}

/**
 * 统计's read names a period too; it gets the window to total and the one to
 * compare it with. Everything starts at the first dated record, which only the
 * caller can look up.
 */
export async function withResolvedStatsPeriod(
  input: unknown,
  timeZone: string,
  findEarliest: (bookId: string | undefined) => Promise<string | null>
): Promise<unknown> {
  const taken = takePeriod(input);
  if (taken == null) return input;
  const bookId = typeof taken.rest.bookId === "string" ? taken.rest.bookId : undefined;
  const earliest = taken.period.range === "all" ? await findEarliest(bookId) : null;
  const window = resolveComparison(taken.period, ledgerToday(timeZone), earliest);
  return {
    ...taken.rest,
    queryRange: window.range,
    compareRange: window.compareRange,
    comparisonMode: window.mode,
    periodEnd: window.periodEnd,
    previousWholeTo: window.previousWholeTo,
  };
}
