import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { omitUndefinedProperties } from "@/lib/validation";
import { requireLedgerAccess } from "@/modules/ledger/access";
import { scheduleProcessingRecoveryAfter } from "@/server/processing/recovery";
import { getSourceDocumentDetailAction } from "@/modules/source-document/server/get-document-detail";
import { listStreamPage } from "@/modules/source-document/server/list-stream-page";
import { getStreamTotal } from "@/modules/source-document/server/stream-total";
import { getStreamRefresh } from "@/modules/source-document/server/stream-refresh";
import {
  sourceDocumentIdSchema,
  streamPageInputSchema,
  streamTotalInputSchema,
} from "@/modules/source-document/contract-schemas";
import { getLedgerEntriesAction } from "@/modules/ledger/server/list-entries";
import { getLedgerStatsAction } from "@/modules/ledger/server/stats";
import { getLedgerAction } from "@/modules/ledger/server/get-ledger";
import {
  getBookAction,
  getBooksAction,
  getBooksIncludingArchivedAction,
} from "@/modules/ledger/server/list-books";
import { getEntryCategoriesAction } from "@/modules/ledger/server/list-categories";
import { getLedgerSettingsAction } from "@/modules/ledger/server/get-ledger-settings";
import {
  getCategoryAssignmentResultsAction,
  getCategoryReclassificationJobAction,
} from "@/modules/ledger/server/get-category-reclassification-job";
import { scheduleCategoryReclassificationRecoveryAfter } from "@/server/category-reclassification/schedule";
import { getEnhancedStats } from "@/modules/stats/server/get-enhanced-stats";
import { parseEnhancedStatsInput } from "@/modules/stats/contract-schemas";

/**
 * The `reclassification` poll below is the recovery driver for a batch AI
 * reclassification run, so this handler has to outlive the default function
 * budget the same way the protected page that starts a run does.
 */
export const maxDuration = 120;

const requestSchema = z
  .object({
    query: z.enum([
      "detail",
      "stream",
      "total",
      "refresh",
      "entries",
      "ledger",
      "books",
      "books-including-archived",
      "book",
      "categories",
      "summary",
      "settings",
      "stats",
      "reclassification",
      "category-assignment-results",
    ]),
    args: z.array(z.unknown()).max(1),
  })
  .strict();

/** The reads that take no input: the ledger itself is resolved from the session. */
const noArgumentsSchema = z.array(z.unknown()).length(0);

export async function POST(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403, headers });
  }
  try {
    const payload = requestSchema.parse(await request.json());
    const input = payload.args[0];
    let result: unknown;
    switch (payload.query) {
      case "stats":
        result = await getEnhancedStats(parseEnhancedStatsInput(input));
        break;
      case "detail":
        result = await getSourceDocumentDetailAction(sourceDocumentIdSchema.parse(input));
        break;
      case "stream": {
        const parsed = streamPageInputSchema.parse(input);
        const { ledger } = await requireLedgerAccess();
        result = await listStreamPage(ledger.id, {
          ...omitUndefinedProperties(parsed),
          limit: parsed.limit,
        });
        scheduleProcessingRecoveryAfter(ledger.id);
        break;
      }
      case "total": {
        const parsed = omitUndefinedProperties(streamTotalInputSchema.parse(input));
        const { ledger } = await requireLedgerAccess();
        result = await getStreamTotal(ledger.id, parsed);
        break;
      }
      case "refresh": {
        const parsed = z.object({ afterVersion: z.string().regex(/^\d+$/) }).parse(input);
        const { ledger } = await requireLedgerAccess();
        result = await getStreamRefresh(ledger.id, parsed);
        scheduleProcessingRecoveryAfter(ledger.id);
        break;
      }
      case "entries":
        result = await getLedgerEntriesAction(input);
        break;
      case "ledger":
        noArgumentsSchema.parse(payload.args);
        result = await getLedgerAction();
        break;
      case "books":
        noArgumentsSchema.parse(payload.args);
        result = await getBooksAction();
        break;
      case "books-including-archived":
        noArgumentsSchema.parse(payload.args);
        result = await getBooksIncludingArchivedAction();
        break;
      case "book":
        result = await getBookAction(input);
        break;
      case "categories":
        noArgumentsSchema.parse(payload.args);
        result = await getEntryCategoriesAction();
        break;
      case "summary":
        result = await getLedgerStatsAction(input ?? {});
        break;
      case "settings":
        noArgumentsSchema.parse(payload.args);
        result = await getLedgerSettingsAction();
        break;
      case "reclassification": {
        noArgumentsSchema.parse(payload.args);
        const { ledger } = await requireLedgerAccess();
        result = await getCategoryReclassificationJobAction();
        // This poll is the recovery trigger: there is no cron, so a run
        // whose after() callback died is restarted on the next poll.
        scheduleCategoryReclassificationRecoveryAfter(ledger.id);
        break;
      }
      case "category-assignment-results":
        result = await getCategoryAssignmentResultsAction(
          z
            .object({
              jobId: z.string().uuid(),
              cursor: z.number().int().nonnegative().optional(),
              limit: z.number().int().min(1).max(50).optional(),
            })
            .strict()
            .parse(input) as { jobId: string; cursor?: number; limit?: number }
        );
        break;
    }
    return NextResponse.json(result, { headers });
  } catch (error) {
    const status =
      error instanceof AppError
        ? error.statusCode
        : error instanceof z.ZodError || error instanceof SyntaxError
          ? 400
          : 500;
    return NextResponse.json(
      { error: status === 500 ? "INTERNAL_ERROR" : "QUERY_FAILED" },
      { status, headers }
    );
  }
}
