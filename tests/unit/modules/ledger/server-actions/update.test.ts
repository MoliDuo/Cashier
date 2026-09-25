import { describe, expect, it } from "vitest";
import { AppError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { toUpdateLedgerActionErrorCode } from "@/modules/ledger/server-actions/update-error";

describe("toUpdateLedgerActionErrorCode", () => {
  it.each([
    [new AppError("missing", "EXCHANGE_RATES_UNAVAILABLE"), "unexpected"],
    [new AppError("unsupported", "CURRENCY_NOT_FOUND"), "unsupported_currency"],
    [new ValidationError("invalid"), "validation_failed"],
    [new ConflictError("conflict"), "conflict"],
    [new NotFoundError("Ledger"), "conflict"],
    [new Error("internal detail"), "unexpected"],
  ])("maps application errors to stable client codes", (error, expected) => {
    expect(toUpdateLedgerActionErrorCode(error)).toBe(expected);
  });
});
