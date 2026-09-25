import { AppError } from "@/lib/errors";
import { compare } from "@/lib/money/decimal";
import type {
  EntryCategoryDto,
  LedgerEntryEmbeddedViewDto,
  LedgerEntryDto,
  ActiveLedgerEntryDto,
  SourceDocumentReferenceDto,
} from "@/modules/ledger/contracts";

type DateFields = { createdAt: Date; updatedAt: Date };
type EntryCategoryRow = Omit<EntryCategoryDto, "createdAt" | "updatedAt"> & DateFields;
type SourceDocumentRow = Pick<
  SourceDocumentReferenceDto,
  "id" | "ledgerId" | "title" | "documentDate"
> &
  DateFields & {
    version: number;
  };
type LedgerEntryRow = Omit<
  LedgerEntryDto,
  "createdAt" | "updatedAt" | "category" | "sourceDocument" | "sourceDocumentId"
> &
  DateFields & { sourceDocumentId: string | null };

function toIso(date: Date | null | undefined): string | null {
  if (date == null) return null;
  return date.toISOString();
}

function mapExchangeRate(value: string | null): string | null {
  return value != null && compare(value, "1") === 0 ? "1" : value;
}

function mapEntryCategoryDto(category: EntryCategoryRow): EntryCategoryDto {
  return {
    id: category.id,
    ledgerId: category.ledgerId,
    name: category.name,
    description: category.description,
    icon: category.icon,
    sortOrder: category.sortOrder,
    createdAt: toIso(category.createdAt)!,
    updatedAt: toIso(category.updatedAt)!,
  };
}

function mapSourceDocumentReferenceDto(
  doc: Pick<
    SourceDocumentRow,
    "id" | "version" | "ledgerId" | "title" | "documentDate" | "createdAt" | "updatedAt"
  >
): SourceDocumentReferenceDto {
  return {
    id: doc.id,
    version: doc.version,
    ledgerId: doc.ledgerId,
    title: doc.title,
    documentDate: doc.documentDate,
    createdAt: toIso(doc.createdAt)!,
    updatedAt: toIso(doc.updatedAt)!,
    hasImages: false,
  };
}

export function mapLedgerEntryEmbeddedViewDto(
  entry: Pick<
    LedgerEntryRow,
    | "id"
    | "ledgerId"
    | "categoryId"
    | "sourceDocumentId"
    | "amount"
    | "currency"
    | "itemName"
    | "description"
    | "convertedAmount"
    | "exchangeRate"
    | "createdAt"
    | "updatedAt"
  > & {
    category?: EntryCategoryRow | null;
  }
): LedgerEntryEmbeddedViewDto {
  if (entry.sourceDocumentId == null) {
    throw new AppError("Active entry has no source document", "INVARIANT_VIOLATION");
  }
  return {
    id: entry.id,
    ledgerId: entry.ledgerId,
    categoryId: entry.categoryId,
    sourceDocumentId: entry.sourceDocumentId,
    amount: entry.amount,
    currency: entry.currency,
    itemName: entry.itemName,
    description: entry.description,
    convertedAmount: entry.convertedAmount,
    exchangeRate: mapExchangeRate(entry.exchangeRate),
    createdAt: toIso(entry.createdAt)!,
    updatedAt: toIso(entry.updatedAt)!,
    ...(entry.category ? { category: mapEntryCategoryDto(entry.category) } : {}),
  };
}

export function mapLedgerEntryDto(
  entry: Pick<
    LedgerEntryRow,
    | "id"
    | "ledgerId"
    | "categoryId"
    | "sourceDocumentId"
    | "amount"
    | "currency"
    | "itemName"
    | "description"
    | "convertedAmount"
    | "exchangeRate"
    | "createdAt"
    | "updatedAt"
  > & {
    category?: EntryCategoryRow | null;
    sourceDocument?: SourceDocumentRow | null;
  }
): ActiveLedgerEntryDto {
  if (
    entry.sourceDocument == null ||
    entry.sourceDocument.id !== entry.sourceDocumentId ||
    entry.sourceDocument.ledgerId !== entry.ledgerId
  ) {
    throw new AppError("Active entry has no matching source document", "INVARIANT_VIOLATION");
  }
  return {
    ...mapLedgerEntryEmbeddedViewDto(entry),
    sourceDocument: mapSourceDocumentReferenceDto(entry.sourceDocument),
  };
}
