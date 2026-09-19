import { z } from "zod";
import { ValidationError } from "@/lib/errors";
import { SUPPORTED_LOCALES } from "@/i18n/locales";
import { getPasswordRuleViolation, PASSWORD_RULE_MESSAGES } from "@/modules/auth/password-rules";

const bookNameSchema = z.string().trim().min(1).max(20);
const emailSchema = z.string().trim().min(3).max(254).email("Enter a valid email address");
// The wizard and the server policy read the same rule, so a password the form
// accepts cannot be one the API rejects.
const passwordSchema = z.string().superRefine((password, context) => {
  const violation = getPasswordRuleViolation(password);
  if (violation == null) return;
  context.addIssue({ code: "custom", message: PASSWORD_RULE_MESSAGES[violation] });
});
const setupCodeSchema = z.string().trim().min(6).max(32);

/**
 * The wizard keeps one blank row visible so the reader always has somewhere to
 * type, and a row they never filled in must not count as a book. Trimming and
 * dropping the empties is therefore part of reading the input, and it happens
 * before validation so the checks below see only names that were meant.
 */
function normalizeBookNames(input: unknown): { books: unknown } {
  const { books } = input as { books?: unknown };
  const trimmed = Array.isArray(books)
    ? books.map((name) => (typeof name === "string" ? name.trim() : name))
    : books;
  return {
    books: Array.isArray(trimmed) ? trimmed.filter((name) => name !== "") : trimmed,
  };
}

export const setupInputSchema = z
  .object({
    setupCode: setupCodeSchema,
    email: emailSchema,
    password: passwordSchema,
    locale: z.enum(SUPPORTED_LOCALES),
    books: z
      .array(bookNameSchema)
      .min(1, "Add at least one book")
      .max(20)
      .refine((names) => new Set(names).size === names.length, "Book names must be unique"),
  })
  .strict();

export type SetupInputContract = z.infer<typeof setupInputSchema>;

export function parseSetupInput(input: unknown): SetupInputContract {
  if (typeof input !== "object" || input === null) {
    throw new ValidationError("Validation failed", {
      issues: [{ code: "custom", path: [], message: "Expected an object" }],
    });
  }
  const { books } = normalizeBookNames(input);
  const result = setupInputSchema.safeParse({
    ...(input as Record<string, unknown>),
    ...(books === undefined ? {} : { books }),
  });
  if (!result.success) {
    throw new ValidationError("Validation failed", { issues: result.error.issues });
  }
  return result.data;
}
