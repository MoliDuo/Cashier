import { AppError, ValidationError } from "@/lib/errors";
import type { UpdateLedgerActionErrorCode } from "@/modules/ledger/contracts";

export function toUpdateLedgerActionErrorCode(error: unknown): UpdateLedgerActionErrorCode {
  if (error instanceof AppError && error.code === "CURRENCY_NOT_FOUND") {
    return "unsupported_currency";
  }
  if (error instanceof ValidationError) return "validation_failed";
  return "unexpected";
}
