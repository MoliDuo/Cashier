import "server-only";
import {
  PostgresProcessingJobAdapter,
  postgresSourceDocumentAggregateAdapter,
} from "@/application/adapters/postgres";
import { loadRevisionProcessingContext } from "@/application/adapters/postgres/revision-processing-context";
import { postgresLedgerProjectionAdapter } from "@/application/adapters/postgres/ledger-projections";
import { postgresRevisionAdapter } from "@/application/adapters/postgres/revisions";
import {
  createExecuteSingleProcessingJob,
  CurrentRevisionProcessor,
  loadStoredFilesForAI,
} from "@/application/adapters/in-process";
import { storedFileAdapter } from "@/application/adapters/storage";
import { getExchangeRates } from "@/modules/currency/server/exchange-rates";
import { getLedgerSettings } from "@/modules/ledger/server/settings";
import { postgresCategoryReclassificationJobAdapter } from "@/application/adapters/postgres/category-reclassification-jobs";
import { postgresCategoryAssignmentV2Adapter } from "@/application/adapters/postgres/category-assignment-v2";
import { createAIContext } from "@/lib/tasks/ai-context";
import { getOpenAIClient } from "@/lib/ai/openai-client";
import { runtimeEnv } from "@/lib/env/runtime";
import type { AIContext } from "@/lib/tasks/types";

function createRevisionProcessor(
  createContext: (signal: AbortSignal) => AIContext = (signal) =>
    createAIContext({
      signal,
      getClient: getOpenAIClient,
      model: runtimeEnv.aiModel,
    })
) {
  return new CurrentRevisionProcessor({
    createAIContext: createContext,
    loadContext: loadRevisionProcessingContext,
    getSettings: getLedgerSettings,
    loadStoredFiles: (ledgerId, storedFileIds) =>
      loadStoredFilesForAI(
        (authorizedLedgerId, storedFileId) =>
          storedFileAdapter.readAuthorized(authorizedLedgerId, storedFileId),
        ledgerId,
        storedFileIds
      ),
    getRates: getExchangeRates,
    recordProcessingFailure: (input) => postgresRevisionAdapter.recordProcessingFailure(input),
    activateRevision: (input) => postgresLedgerProjectionAdapter.activateRevision(input),
  });
}

const executeSingleProcessingJob = createExecuteSingleProcessingJob({
  createProcessingJobAdapter: () => new PostgresProcessingJobAdapter(),
  createRevisionProcessor: () => createRevisionProcessor(),
  recordProcessingFailure: (input) => postgresRevisionAdapter.recordProcessingFailure(input),
});

/** Composition root for the PostgreSQL-backed runtime. */
export const serverComposition = {
  categoryReclassificationJobs: postgresCategoryReclassificationJobAdapter,
  categoryAssignments: postgresCategoryAssignmentV2Adapter,
  storedFiles: storedFileAdapter,
  sourceDocumentAggregate: postgresSourceDocumentAggregateAdapter,
  processingRecovery: new PostgresProcessingJobAdapter(),
  createRevisionProcessor,
  executeSingleProcessingJob,
} as const;
