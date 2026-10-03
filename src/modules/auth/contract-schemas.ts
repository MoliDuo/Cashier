import { z } from "zod";
import { ValidationError } from "@/lib/errors";
import { normalizeEmail } from "@/lib/utils/email";

const MAX_EMAIL_LENGTH = 254;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const loginEmailSchema = z
  .unknown()
  .superRefine((value, ctx) => {
    if (typeof value !== "string" || value === "" || value.length > MAX_EMAIL_LENGTH) {
      ctx.addIssue({ code: "custom", message: "Invalid email address" });
      return;
    }
    if (!EMAIL_REGEX.test(normalizeEmail(value))) {
      ctx.addIssue({ code: "custom", message: "Invalid email format" });
    }
  })
  .transform((value) => normalizeEmail(value as string));

/** A login address, trimmed and lowercased the way `login_emails` stores it. */
export function parseLoginEmail(input: unknown): string {
  const result = loginEmailSchema.safeParse(input);
  if (!result.success) {
    const firstIssue = result.error.issues[0];
    throw new ValidationError(firstIssue?.message ?? "Validation failed", {
      issues: result.error.issues,
    });
  }
  return result.data;
}
