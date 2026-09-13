import { z } from "zod";
import { ValidationError } from "@/lib/errors";
import {
  dateStringSchema,
  omitUndefinedObjectFields,
  optionalDateStringSchema,
  UUID_REGEX,
} from "@/lib/validation";
import { MAX_BATCH_SIZE } from "@/lib/batch-ids";
import { CATEGORY_PRESET_IDS } from "@/config/category-presets";
import { SUPPORTED_LOCALES } from "@/i18n/locales";
import { isValidTimeZone } from "@/lib/date-utils";
import { MAX_SEARCH_LENGTH, normalizeSearchTerm } from "@/lib/search";
import { compare, DECIMAL_STRING_PATTERN, normalize } from "@/lib/money/decimal";

const uuidSchema = z.string().regex(UUID_REGEX, "Invalid UUID");
const ledgerIdSchema = uuidSchema;
const strictObjectSchema = <TShape extends z.ZodRawShape>(shape: TShape) =>
  z.preprocess(omitUndefinedObjectFields, z.object(shape).strict());
const nonEmptyStrictObjectSchema = <TShape extends z.ZodRawShape>(shape: TShape) =>
  z.preprocess(
    omitUndefinedObjectFields,
    z
      .object(shape)
      .strict()
      .refine((value) => Object.keys(value).length > 0, "At least one field is required")
  );
const currencyCodeSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toUpperCase() : value),
  z.string().regex(/^[A-Z]{3}$/, "Currency must be a 3-letter ISO 4217 code")
);
const optionalCurrencyCodeSchema = currencyCodeSchema.optional();
const nullableCurrencyCodeSchema = currencyCodeSchema.nullable().optional();
const aiLanguageSchema = z.string().min(2).max(35);
const positiveDecimalSchema = z
  .string()
  .regex(DECIMAL_STRING_PATTERN, "Amount must be a plain decimal string")
  .transform(normalize)
  .refine((value) => compare(value, "0") > 0, "Amount must be positive");
const nonZeroDecimalSchema = z
  .string()
  .regex(DECIMAL_STRING_PATTERN, "Amount must be a plain decimal string")
  .transform(normalize)
  .refine((value) => compare(value, "0") !== 0, "Amount must be non-zero");
const optionalQueryDecimalSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim() : value),
  z
    .string()
    .regex(DECIMAL_STRING_PATTERN, "Amount must be a plain decimal string")
    .transform(normalize)
    .optional()
);
const optionalSearchSchema = z.preprocess(
  (value) => (typeof value === "string" ? normalizeSearchTerm(value) : value),
  z.string().max(MAX_SEARCH_LENGTH).optional()
);
export const UNCATEGORIZED_SENTINEL = "__uncategorized__";
const categoryFilterSchema = z.union([uuidSchema, z.literal(UNCATEGORIZED_SENTINEL)]).optional();

function parseLedgerContract<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError("Validation failed", { issues: result.error.issues });
  }
  return result.data;
}

const updateLedgerInputSchema = nonEmptyStrictObjectSchema({
  expectedUpdatedAt: z.string().datetime({ offset: true }),
  settings: nonEmptyStrictObjectSchema({
    aiLanguage: aiLanguageSchema.optional(),
    currencies: z.array(currencyCodeSchema).max(32).optional(),
    mainCurrency: optionalCurrencyCodeSchema,
    collapseEntriesDefault: z.boolean().optional(),
    aiCustomPrompt: z.string().max(4000).optional(),
    timeZone: z
      .string()
      .max(50)
      .refine(isValidTimeZone, "Invalid IANA time zone")
      .nullable()
      .optional(),
  }),
});

const createEntryCategoryInputSchema = strictObjectSchema({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(500).optional(),
  icon: z.string().max(100).optional(),
  sortOrder: z.number().int().min(0).optional(),
});

const updateEntryCategoryInputSchema = nonEmptyStrictObjectSchema({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  icon: z.string().max(100).nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

const reorderEntryCategoriesInputSchema = z.array(uuidSchema).min(1).max(MAX_BATCH_SIZE);
const categoryCollectionRevisionSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "Invalid category collection revision");
const saveEntryCategoriesInputSchema = strictObjectSchema({
  expectedRevision: categoryCollectionRevisionSchema,
  categories: z
    .array(
      strictObjectSchema({
        id: uuidSchema.optional(),
        clientId: uuidSchema.optional(),
        name: z.string().trim().min(1).max(100),
        description: z.string().max(500).nullable(),
        icon: z.string().max(100).nullable(),
      }).superRefine((category, context) => {
        if ((category.id == null) === (category.clientId == null)) {
          context.addIssue({
            code: "custom",
            message: "Exactly one of id or clientId is required",
          });
        }
      })
    )
    .max(MAX_BATCH_SIZE)
    .superRefine((categories, context) => {
      const ids = categories.map((category) => category.id ?? category.clientId!);
      if (new Set(ids).size !== ids.length) {
        context.addIssue({ code: "custom", message: "Category IDs must be unique" });
      }
    }),
});
const applyCategoryPresetInputSchema = strictObjectSchema({
  expectedRevision: categoryCollectionRevisionSchema,
  presetId: z.enum(CATEGORY_PRESET_IDS),
  locale: z.enum(SUPPORTED_LOCALES),
  mappings: z
    .array(
      strictObjectSchema({
        fromCategoryId: uuidSchema,
        toPresetIndex: z.number().int().nonnegative().nullable(),
      })
    )
    .max(MAX_BATCH_SIZE)
    .superRefine((mappings, context) => {
      const ids = mappings.map((mapping) => mapping.fromCategoryId);
      if (new Set(ids).size !== ids.length) {
        context.addIssue({ code: "custom", message: "Category IDs must be unique" });
      }
    }),
});
const ledgerEntryIdSchema = uuidSchema;
const ledgerEntryIdsSchema = z.preprocess(
  (value) => (Array.isArray(value) ? [...new Set(value)] : value),
  z.array(uuidSchema).min(1).max(MAX_BATCH_SIZE)
);
const entryCategoryIdSchema = uuidSchema;
const serviceCredentialIdSchema = uuidSchema;

const createLedgerEntryInputSchema = strictObjectSchema({
  amount: positiveDecimalSchema,
  currency: optionalCurrencyCodeSchema,
  itemName: z.string().trim().min(1).max(200),
  categoryId: uuidSchema.optional(),
  description: z.string().max(500).nullable().optional(),
  sourceDocumentId: uuidSchema,
});

export const updateLedgerEntryInputSchema = nonEmptyStrictObjectSchema({
  categoryId: uuidSchema.nullable().optional(),
  amount: nonZeroDecimalSchema.optional(),
  currency: nullableCurrencyCodeSchema,
  itemName: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(500).nullable().optional(),
});

const batchUpdateLedgerEntriesInputSchema = nonEmptyStrictObjectSchema({
  categoryId: uuidSchema.nullable().optional(),
  currency: nullableCurrencyCodeSchema,
  amount: nonZeroDecimalSchema.optional(),
  description: z.string().max(500).nullable().optional(),
  itemName: z.string().trim().min(1).max(200).optional(),
});

const batchUpdateLedgerEntryDatesInputSchema = strictObjectSchema({
  entryIds: ledgerEntryIdsSchema,
  entryDate: dateStringSchema,
});

const createServiceCredentialInputSchema = strictObjectSchema({
  name: z.string().trim().min(1).max(100),
});

const ledgerEntryQueryShape = {
  startDate: optionalDateStringSchema,
  endDate: optionalDateStringSchema,
  categoryId: categoryFilterSchema,
  currency: optionalCurrencyCodeSchema,
  minAmount: optionalQueryDecimalSchema,
  maxAmount: optionalQueryDecimalSchema,
  search: optionalSearchSchema,
};

function validateLedgerEntryQueryRange(
  value: {
    startDate?: string | undefined;
    endDate?: string | undefined;
    minAmount?: string | undefined;
    maxAmount?: string | undefined;
  },
  context: z.RefinementCtx
) {
  if (value.startDate != null && value.endDate != null && value.startDate > value.endDate) {
    context.addIssue({
      code: "custom",
      path: ["endDate"],
      message: "End date precedes start date",
    });
  }
  if (
    value.minAmount != null &&
    value.maxAmount != null &&
    compare(value.minAmount, value.maxAmount) > 0
  ) {
    context.addIssue({
      code: "custom",
      path: ["maxAmount"],
      message: "Maximum amount is less than minimum amount",
    });
  }
}

export const listLedgerEntriesInputSchema = strictObjectSchema({
  ...ledgerEntryQueryShape,
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).superRefine(validateLedgerEntryQueryRange);

export const ledgerStatsQuerySchema = strictObjectSchema({
  ...ledgerEntryQueryShape,
  categoryId: categoryFilterSchema,
}).superRefine(validateLedgerEntryQueryRange);

export const parseUpdateLedgerInput = (input: unknown) =>
  parseLedgerContract(updateLedgerInputSchema, input);
export const parseCreateEntryCategoryInput = (input: unknown) =>
  parseLedgerContract(createEntryCategoryInputSchema, input);
export const parseUpdateEntryCategoryInput = (input: unknown) =>
  parseLedgerContract(updateEntryCategoryInputSchema, input);
export const parseReorderEntryCategoriesInput = (input: unknown) =>
  parseLedgerContract(reorderEntryCategoriesInputSchema, input);
export const parseSaveEntryCategoriesInput = (input: unknown) =>
  parseLedgerContract(saveEntryCategoriesInputSchema, input);
export const parseApplyCategoryPresetInput = (input: unknown) =>
  parseLedgerContract(applyCategoryPresetInputSchema, input);
export const parseEntryCategoryId = (input: unknown) =>
  parseLedgerContract(entryCategoryIdSchema, input);
export const parseCreateLedgerEntryInput = (input: unknown) =>
  parseLedgerContract(createLedgerEntryInputSchema, input);
export const parseUpdateLedgerEntryInput = (input: unknown) =>
  parseLedgerContract(updateLedgerEntryInputSchema, input);
export const parseBatchUpdateLedgerEntriesInput = (input: unknown) =>
  parseLedgerContract(batchUpdateLedgerEntriesInputSchema, input);
export const parseBatchUpdateLedgerEntryDatesInput = (input: unknown) =>
  parseLedgerContract(batchUpdateLedgerEntryDatesInputSchema, input);
export const parseLedgerEntryId = (input: unknown) =>
  parseLedgerContract(ledgerEntryIdSchema, input);
export const parseLedgerEntryIds = (input: unknown) =>
  parseLedgerContract(ledgerEntryIdsSchema, input);
export const parseCreateServiceCredentialInput = (input: unknown) =>
  parseLedgerContract(createServiceCredentialInputSchema, input);
export const parseServiceCredentialId = (input: unknown) =>
  parseLedgerContract(serviceCredentialIdSchema, input);
export const parseListLedgerEntriesInput = (input: unknown) =>
  parseLedgerContract(listLedgerEntriesInputSchema, input);
export const parseLedgerId = (input: unknown) => parseLedgerContract(ledgerIdSchema, input);
export const parseLedgerStatsQuery = (input: unknown) =>
  parseLedgerContract(ledgerStatsQuerySchema, input);

export type UpdateLedgerInput = z.infer<typeof updateLedgerInputSchema>;
export type CreateEntryCategoryInput = z.infer<typeof createEntryCategoryInputSchema>;
export type UpdateEntryCategoryInput = z.infer<typeof updateEntryCategoryInputSchema>;
export type SaveEntryCategoriesInput = z.infer<typeof saveEntryCategoriesInputSchema>;
export type CreateLedgerEntryInput = z.infer<typeof createLedgerEntryInputSchema>;
export type UpdateLedgerEntryInput = z.infer<typeof updateLedgerEntryInputSchema>;
export type BatchUpdateLedgerEntriesInput = z.infer<typeof batchUpdateLedgerEntriesInputSchema>;
export type CreateServiceCredentialInput = z.infer<typeof createServiceCredentialInputSchema>;
export type ListLedgerEntriesInput = z.input<typeof listLedgerEntriesInputSchema>;
export type ListLedgerEntriesValidatedInput = z.infer<typeof listLedgerEntriesInputSchema>;
export type LedgerStatsQueryInput = z.infer<typeof ledgerStatsQuerySchema>;
