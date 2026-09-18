import { z } from "zod";
import { ValidationError } from "@/lib/errors";
import { SUPPORTED_LOCALES } from "@/i18n/locales";

const bookNameSchema = z.string().trim().min(1).max(20);
const emailSchema = z.string().trim().min(3).max(254).email("Enter a valid email address");
const passwordSchema = z.string().min(8).max(128);
const setupCodeSchema = z.string().trim().min(6).max(32);

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
    defaultBook: bookNameSchema,
  })
  .strict()
  .refine((value) => value.books.includes(value.defaultBook), {
    message: "The default book must be one of the books",
    path: ["defaultBook"],
  });

export type SetupInputContract = z.infer<typeof setupInputSchema>;

export function parseSetupInput(input: unknown): SetupInputContract {
  const result = setupInputSchema.safeParse(input);
  if (!result.success) {
    throw new ValidationError("Validation failed", { issues: result.error.issues });
  }
  return result.data;
}
