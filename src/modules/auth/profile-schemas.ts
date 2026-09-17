import { z } from "zod";
import { ValidationError } from "@/lib/errors";
import { nullableTimeZoneSchema } from "@/modules/ledger/contract-schemas";
import type { MemberProfileUpdateContract } from "@/application/contracts";

export const MAX_NICKNAME_LENGTH = 20;

/**
 * The nickname is trimmed before its length is measured, matching the database
 * check, so a name that is only spaces is rejected here rather than by a
 * constraint violation.
 */
const updateMyProfileInputSchema = z
  .object({
    nickname: z
      .string()
      .transform((value) => value.trim())
      .pipe(z.string().min(1).max(MAX_NICKNAME_LENGTH)),
    gender: z.enum(["male", "female"]),
    timeZone: nullableTimeZoneSchema,
  })
  .strict();

export function parseUpdateMyProfileInput(input: unknown): MemberProfileUpdateContract {
  const result = updateMyProfileInputSchema.safeParse(input);
  if (!result.success) {
    throw new ValidationError("Validation failed", { issues: result.error.issues });
  }
  return result.data;
}
