import { ValidationError } from "@/lib/errors";
import type { SourceDocumentListItemDto, StreamPage } from "../../contracts";
import type { SourceDocumentProcessingStatus } from "@/modules/source-document/types";
import { normalizeSearchTerm } from "@/lib/search";
import type { LedgerChangeReadPort, SourceDocumentReadPort } from "../ports";
import type { LedgerReadPort } from "@/modules/ledger/application/ports";
import { filterStreamEntries } from "../../stream-filter-policy";
import { createHash } from "node:crypto";
import {
  decodeSourceDocumentStreamCursor,
  encodeSourceDocumentPageCursor,
  encodeSourceDocumentStreamCursor,
} from "./source-document-cursor";

const STREAM_PAGE_LIMIT = 20;

export interface ListStreamPageInput {
  attributedUserId?: string;
  startDate?: string | null | undefined;
  endDate?: string | null | undefined;
  minAmount?: string;
  maxAmount?: string;
  statuses?: string[];
  search?: string;
  cursor?: string | null | undefined;
  limit: number;
}

// ---------------------------------------------------------------------------
// Stream cursor helpers
// ---------------------------------------------------------------------------

/**
 * Decode a versioned stream cursor into its components.
 * Expected format: v2|ledgerId|effectiveDate|createdAt|id
 */
/**
 * Validate that a cursor is compatible with the current ledger and filter inputs.
 * Returns the decoded inner cursor string for a valid cursor, or null when no
 * cursor was provided (first-page fetch).
 * Throws ValidationError for malformed, incompatible, or stale cursors so the
 * caller can signal the client to restart from page one.
 */
function validateCursor(
  cursor: string | null | undefined,
  ledgerId: string,
  generation: string,
  filterHash: string
): string | null {
  if (cursor == null || cursor === "") return null;
  const decoded = decodeSourceDocumentStreamCursor(cursor);
  if (decoded == null) {
    throw new ValidationError("Invalid cursor format, restart required");
  }
  if (decoded.ledgerId !== ledgerId) {
    throw new ValidationError("Cross-ledger cursor, restart required");
  }
  if (decoded.generation !== generation || decoded.filterHash !== filterHash) {
    throw new ValidationError("Stale stream cursor, restart required");
  }
  return encodeSourceDocumentPageCursor(decoded.page);
}

function filterFingerprint(input: ListStreamPageInput, search: string | undefined): string {
  const normalized = {
    attributedUserId: input.attributedUserId ?? null,
    startDate: input.startDate ?? null,
    endDate: input.endDate ?? null,
    minAmount: input.minAmount ?? null,
    maxAmount: input.maxAmount ?? null,
    statuses: [...new Set(input.statuses ?? [])].sort(),
    search: search?.trim() ?? null,
  };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex").slice(0, 16);
}

// ---------------------------------------------------------------------------
// Page query
// ---------------------------------------------------------------------------

export async function listStreamPage(
  ledgerId: string,
  input: ListStreamPageInput,
  ports: {
    documents: Pick<SourceDocumentReadPort, "list">;
    ledgerReads: Pick<LedgerReadPort, "listEntriesBySourceDocumentIds">;
    changes: Pick<LedgerChangeReadPort, "getVersion" | "getRefreshBaseline">;
  }
): Promise<StreamPage> {
  // Enforce page size cap (defense in depth beyond the action schema)
  const limit = Math.min(input.limit, STREAM_PAGE_LIMIT);
  const search = normalizeSearchTerm(input.search);
  const filterHash = filterFingerprint(input, search);
  const beforeVersion = await ports.changes.getVersion(ledgerId);
  const generation = beforeVersion.toString();

  // Validate cursor against ledger identity and filter compatibility.
  // Throws ValidationError for malformed/incompatible cursors so the client
  // can discard stale pages and restart from page one.
  let innerCursor: string | null;
  try {
    innerCursor = validateCursor(input.cursor, ledgerId, generation, filterHash);
  } catch (error) {
    if (error instanceof ValidationError) {
      const baseline = await ports.changes.getRefreshBaseline(ledgerId);
      return {
        items: [],
        nextCursor: null,
        generation: baseline.version.toString(),
        hasTransitionalWork: baseline.hasTransitionalWork,
        restartRequired: true,
      };
    }
    throw error;
  }

  const page = await ports.documents.list({
    ledgerId,
    ...(input.attributedUserId == null ? {} : { attributedUserId: input.attributedUserId }),
    ...(input.statuses != null && input.statuses.length > 0
      ? { statuses: input.statuses as unknown as SourceDocumentProcessingStatus[] }
      : {}),
    ...(input.startDate != null && input.startDate !== "" ? { startDate: input.startDate } : {}),
    ...(input.endDate != null && input.endDate !== "" ? { endDate: input.endDate } : {}),
    ...(input.minAmount != null ? { minAmount: input.minAmount } : {}),
    ...(input.maxAmount != null ? { maxAmount: input.maxAmount } : {}),
    ...(search != null ? { search } : {}),
    ...(innerCursor != null ? { cursor: innerCursor } : {}),
    limit,
  });

  // Batch-load ledger entries for items that need them (completed cards etc.)
  const entriesByDocId = await ports.ledgerReads.listEntriesBySourceDocumentIds({
    ledgerId,
    sourceDocumentIds: page.items.map((item) => item.id),
  });

  const items = page.items.map((item) => ({
    ...item,
    ledgerEntries: filterStreamEntries(entriesByDocId.get(item.id) ?? [], {
      ...(input.minAmount != null ? { minAmount: input.minAmount } : {}),
      ...(input.maxAmount != null ? { maxAmount: input.maxAmount } : {}),
      ...(search != null ? { search } : {}),
    }),
  }));
  const baseline = await ports.changes.getRefreshBaseline(ledgerId);
  if (baseline.version !== beforeVersion) {
    return {
      items: [],
      nextCursor: null,
      generation: baseline.version.toString(),
      hasTransitionalWork: baseline.hasTransitionalWork,
      restartRequired: true,
    };
  }

  return {
    items: items as SourceDocumentListItemDto[],
    nextCursor: encodeSourceDocumentStreamCursor(ledgerId, generation, filterHash, page.nextCursor),
    generation,
    hasTransitionalWork: baseline.hasTransitionalWork,
  };
}
