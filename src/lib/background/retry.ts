import { AppError } from "@/lib/errors";

// The one retry policy every background flow shares.

/**
 * Transient failures are worth another attempt later; permanent ones will
 * fail the same way again; configuration failures need an operator.
 */
export type FailureKind = "transient" | "permanent" | "configuration";

export interface ClassifiedFailure {
  kind: FailureKind;
  /** The code the failure was classified by, when one was found. */
  code: string | null;
  /** How long the provider asked callers to wait, when it said. */
  retryAfterMs: number | null;
}

const TRANSIENT_CODES = new Set(["ai_rate_limited", "ai_provider_unavailable", "ai_timeout"]);
const CONFIGURATION_CODES = new Set(["ai_configuration_invalid"]);

/** Every error in the `cause` chain, outermost first. */
function causeChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  let current = error;
  while (current != null && chain.length < 10 && !chain.includes(current)) {
    chain.push(current);
    current = current instanceof Error ? current.cause : undefined;
  }
  return chain;
}

/** The first application error code in the `cause` chain. */
export function findAppErrorCode(error: unknown): string | null {
  const found = causeChain(error).find((item): item is AppError => item instanceof AppError);
  return found?.code ?? null;
}

/**
 * Classifies a failure by the innermost application error that explains it:
 * wrappers such as a parse failure keep the provider's error as their cause.
 */
export function classifyFailure(error: unknown): ClassifiedFailure {
  for (const item of causeChain(error)) {
    if (!(item instanceof AppError)) continue;
    if (CONFIGURATION_CODES.has(item.code)) {
      return { kind: "configuration", code: item.code, retryAfterMs: null };
    }
    if (TRANSIENT_CODES.has(item.code)) {
      const retryAfter = item.details?.retryAfterMs;
      return {
        kind: "transient",
        code: item.code,
        retryAfterMs: typeof retryAfter === "number" && retryAfter > 0 ? retryAfter : null,
      };
    }
  }
  return { kind: "permanent", code: findAppErrorCode(error), retryAfterMs: null };
}

const RETRY_BASE_DELAY_MS = 2_000;
const RETRY_MAX_DELAY_MS = 60_000;

/**
 * How long to wait before the next attempt after the given one failed:
 * 2s, 8s, 32s, then a minute, or longer when the provider asked for it.
 */
export function retryDelayMs(attempt: number, retryAfterMs: number | null = null): number {
  const backoff = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 4 ** Math.max(0, attempt - 1));
  return Math.max(retryAfterMs ?? 0, backoff);
}
