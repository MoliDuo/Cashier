import { postLedgerQuery } from "@/lib/queries/post-ledger-query";
import type { LedgerStatsQueryInput, ListLedgerEntriesInput } from "./contract-schemas";
import type {
  BookDto,
  CategoryAssignmentResultPageDto,
  CategoryReclassificationJobDto,
  EntryCategoryWithCountDto,
  LedgerDto,
  LedgerEntryPageDto,
  LedgerSettingsViewDto,
  LedgerSummaryDto,
} from "./contracts";

/** Browser reads of the ledger, served by `/api/ledger-queries`. */
export const fetchLedger = () => postLedgerQuery<LedgerDto>("ledger");

export const fetchLedgerEntries = (input: ListLedgerEntriesInput) =>
  postLedgerQuery<LedgerEntryPageDto>("entries", [input]);

export const fetchLedgerSummary = (input: LedgerStatsQueryInput) =>
  postLedgerQuery<LedgerSummaryDto>("summary", [input]);

/** The three book reads the switcher, 设置 and the detail page use. */
export const fetchBooks = () => postLedgerQuery<BookDto[]>("books");

export const fetchBooksIncludingArchived = () =>
  postLedgerQuery<BookDto[]>("books-including-archived");

export const fetchBook = (bookId: string) => postLedgerQuery<BookDto | null>("book", [bookId]);

export const fetchEntryCategories = () =>
  postLedgerQuery<EntryCategoryWithCountDto[]>("categories");

export const fetchLedgerSettings = () => postLedgerQuery<LedgerSettingsViewDto>("settings");

export const fetchCategoryReclassificationJob = () =>
  postLedgerQuery<CategoryReclassificationJobDto | null>("reclassification");

export const fetchCategoryAssignmentResults = (input: {
  jobId: string;
  cursor?: number;
  limit?: number;
}) => postLedgerQuery<CategoryAssignmentResultPageDto>("category-assignment-results", [input]);
