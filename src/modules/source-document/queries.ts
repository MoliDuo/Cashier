import { postLedgerQuery } from "@/lib/queries/post-ledger-query";
import type {
  GetStreamTotalInput,
  ListStreamPageInput,
  SourceDocumentDetailDto,
  SourceDocumentInputDto,
  StreamPage,
  StreamTotalDto,
} from "./contracts";
import type { LedgerRefreshRequest, LedgerRefreshResult } from "./contract-refresh";

/** Browser reads of source documents, served by `/api/ledger-queries`. */
export const fetchSourceDocumentDetail = (id: string) =>
  postLedgerQuery<SourceDocumentDetailDto | null>("detail", [id]);

export const fetchSourceDocumentInput = (id: string) =>
  postLedgerQuery<SourceDocumentInputDto>("source-document-input", [id]);

export const fetchStreamPage = (input: ListStreamPageInput) =>
  postLedgerQuery<StreamPage>("stream", [input]);

export const fetchStreamTotal = (input: GetStreamTotalInput) =>
  postLedgerQuery<StreamTotalDto>("total", [input]);

export const fetchStreamRefresh = (input: LedgerRefreshRequest) =>
  postLedgerQuery<LedgerRefreshResult>("refresh", [input]);
