import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { omitUndefinedProperties } from "@/lib/validation";
import { requireLedgerAccess } from "@/modules/ledger/access";
import { serverComposition } from "@/application/server-composition-root";
import { scheduleProcessingRecoveryAfter } from "@/application/processing/schedule-processing-recovery";
import { getSourceDocumentLightAction } from "@/modules/source-document/server/get-document-light";
import { listStreamPage } from "@/modules/source-document/application/queries/list-stream-page";
import { getStreamTotal } from "@/modules/source-document/application/queries/get-stream-total";
import { getStreamRefresh } from "@/modules/source-document/application/queries/get-stream-refresh";
import {
  sourceDocumentIdSchema,
  streamPageInputSchema,
  streamTotalInputSchema,
} from "@/modules/source-document/contract-schemas";
import { getLedgerEntriesAction } from "@/modules/ledger/server/list-entries";
import { getLedgerStatsAction } from "@/modules/ledger/server/stats";
import { getLedgerEntryAction } from "@/modules/ledger/server/get-entry";
import { getCategoryReclassificationJobAction } from "@/modules/ledger/server/get-category-reclassification-job";
import { scheduleCategoryReclassificationRecoveryAfter } from "@/application/processing/schedule-category-reclassification";
import {
  parseLedgerStatsQuery,
  parseListLedgerEntriesInput,
  parseLedgerEntryId,
} from "@/modules/ledger/contract-schemas";
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
      "entry",
      "summary",
      "stats",
      "reclassification",
    ]),
    args: z.array(z.unknown()).min(1).max(2),
  })
  .strict();

export async function POST(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403, headers });
  }
  try {
    const payload = requestSchema.parse(await request.json());
    let result: unknown;
    if (payload.query === "stats") {
      const input = parseEnhancedStatsInput(payload.args[0]);
      result = await getEnhancedStats(input);
    } else {
      const ledgerId = z.string().uuid().parse(payload.args[0]);
      if (["stream", "total", "refresh"].includes(payload.query))
        await requireLedgerAccess(ledgerId);
      const input = payload.args[1];
      switch (payload.query) {
        case "detail":
          result = await getSourceDocumentLightAction(
            ledgerId,
            sourceDocumentIdSchema.parse(input)
          );
          break;
        case "stream": {
          const parsed = streamPageInputSchema.parse(input);
          result = await listStreamPage(
            ledgerId,
            { ...omitUndefinedProperties(parsed), limit: parsed.limit },
            {
              documents: serverComposition.sourceDocumentReads,
              ledgerReads: serverComposition.ledgerReads,
              changes: serverComposition.ledgerChanges,
            }
          );
          scheduleProcessingRecoveryAfter(ledgerId);
          break;
        }
        case "total":
          result = await getStreamTotal(
            ledgerId,
            omitUndefinedProperties(streamTotalInputSchema.parse(input)),
            serverComposition.sourceDocumentReads
          );
          break;
        case "refresh":
          result = await getStreamRefresh(
            ledgerId,
            z.object({ afterVersion: z.string().regex(/^\d+$/) }).parse(input),
            serverComposition.ledgerChanges
          );
          scheduleProcessingRecoveryAfter(ledgerId);
          break;
        case "entries":
          result = await getLedgerEntriesAction(ledgerId, parseListLedgerEntriesInput(input));
          break;
        case "entry":
          result = await getLedgerEntryAction(ledgerId, parseLedgerEntryId(input));
          break;
        case "summary":
          result = await getLedgerStatsAction(ledgerId, parseLedgerStatsQuery(input ?? {}));
          break;
        case "reclassification":
          result = await getCategoryReclassificationJobAction(ledgerId);
          // This poll is the recovery trigger: a run whose after() callback
          // died is restarted on the next poll instead of waiting for the
          // periodic drain.
          scheduleCategoryReclassificationRecoveryAfter(ledgerId);
          break;
      }
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
