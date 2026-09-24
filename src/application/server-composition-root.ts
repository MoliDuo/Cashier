import "server-only";
import {
  postgresBookAdapter,
  postgresCategoryAdapter,
  postgresCurrencyAdapter,
  postgresLedgerAdapter,
  postgresOtpTokenAdapter,
  postgresServiceCredentialAdapter,
  postgresSettingsAdapter,
  postgresSetupAdapter,
  postgresUserAccountAdapter,
  calculateCompletedSourceDocumentTotal,
  getTargetSourceDocument,
  getTargetSourceDocumentAccessContext,
  getSourceDocumentInput,
  PostgresProcessingJobAdapter,
  listTargetSourceDocuments,
  postgresSourceDocumentAggregateAdapter,
} from "@/application/adapters/postgres";
import { loadRevisionProcessingContext } from "@/application/adapters/postgres/revision-processing-context";
import { postgresLedgerProjectionAdapter } from "@/application/adapters/postgres/ledger-projections";
import { postgresRevisionAdapter } from "@/application/adapters/postgres/revisions";
import { postgresAccountSecurityAdapter } from "@/application/adapters/postgres/account-security";
import { postgresCredentialSourceDocumentReadAdapter } from "@/application/adapters/postgres/credential-source-document-status";
import { postgresLedgerChangeReadAdapter } from "@/application/adapters/postgres/ledger-changes";
import { postgresRateLimiter } from "@/application/adapters/postgres/api-rate-limit";
import { resendEmailAdapter } from "@/application/adapters/email/resend";
import {
  createExecuteSingleProcessingJob,
  CurrentRevisionProcessor,
  loadStoredFilesForAI,
} from "@/application/adapters/in-process";
import { storedFileAdapter } from "@/application/adapters/storage";
import { listLedgerEntryPage } from "@/application/adapters/postgres/ledger-reads/list-ledger-entry-page";
import { getBatchEntryDateImpact } from "@/application/adapters/postgres/ledger-reads/get-batch-entry-date-impact";
import { getLedgerEntryDetail } from "@/application/adapters/postgres/ledger-reads/get-ledger-entry-detail";
import { calculateLedgerEntryStats } from "@/application/adapters/postgres/ledger-reads/calculate-ledger-entry-stats";
import { listLedgerEntryViewsBySourceDocumentIds } from "@/application/adapters/postgres/ledger-reads/list-ledger-entry-views-by-source-document-ids";
import { hasActiveLedgerEntries } from "@/application/adapters/postgres/ledger-reads/has-active-entries";
import { getEnhancedStatsQuery } from "@/application/adapters/postgres/ledger-reads/get-enhanced-stats";
import {
  postgresFxRateBook,
  fetchWithRetry as fetchExchangeRatesWithRetry,
} from "@/application/adapters/postgres/exchange-rate";
import { categoryMetadataGeneratorAdapter } from "@/application/adapters/ai/category-metadata-generator";
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
    getSettings: (ledgerId) => postgresSettingsAdapter.get(ledgerId),
    loadStoredFiles: (ledgerId, storedFileIds) =>
      loadStoredFilesForAI(
        (authorizedLedgerId, storedFileId) =>
          storedFileAdapter.readAuthorized(authorizedLedgerId, storedFileId),
        ledgerId,
        storedFileIds
      ),
    getRates: (date) => postgresFxRateBook.getRates(date),
    recordProcessingFailure: (input) => postgresRevisionAdapter.recordProcessingFailure(input),
    getRevision: (ledgerId, sourceDocumentId) =>
      postgresRevisionAdapter.get(ledgerId, sourceDocumentId),
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
  accountSecurity: postgresAccountSecurityAdapter,
  books: postgresBookAdapter,
  rateLimiter: postgresRateLimiter,
  categories: postgresCategoryAdapter,
  currencies: postgresCurrencyAdapter,
  email: resendEmailAdapter,
  exchangeRates: postgresFxRateBook,
  fetchExchangeRatesWithRetry,
  ledgers: postgresLedgerAdapter,
  ledgerReads: {
    hasActiveEntries: hasActiveLedgerEntries,
    calculateStats: calculateLedgerEntryStats,
    getBatchEntryDateImpact,
    getEntry: getLedgerEntryDetail,
    listEntries: listLedgerEntryPage,
    listEntriesBySourceDocumentIds: listLedgerEntryViewsBySourceDocumentIds,
  },
  categoryMetadataGenerator: categoryMetadataGeneratorAdapter,
  categoryReclassificationJobs: postgresCategoryReclassificationJobAdapter,
  categoryAssignments: postgresCategoryAssignmentV2Adapter,
  stats: {
    queryEnhanced: getEnhancedStatsQuery,
  },
  otpTokens: postgresOtpTokenAdapter,
  serviceCredentials: postgresServiceCredentialAdapter,
  settings: postgresSettingsAdapter,
  setup: postgresSetupAdapter,
  storedFiles: storedFileAdapter,
  sourceDocumentAggregate: postgresSourceDocumentAggregateAdapter,
  sourceDocumentReads: {
    calculateCompletedTotal: calculateCompletedSourceDocumentTotal,
    getInput: getSourceDocumentInput,
    get: getTargetSourceDocument,
    getAccessContext: getTargetSourceDocumentAccessContext,
    list: listTargetSourceDocuments,
  },
  credentialSourceDocuments: postgresCredentialSourceDocumentReadAdapter,
  ledgerChanges: postgresLedgerChangeReadAdapter,
  processingRecovery: new PostgresProcessingJobAdapter(),
  createRevisionProcessor,
  executeSingleProcessingJob,
  userAccounts: postgresUserAccountAdapter,
} as const;
