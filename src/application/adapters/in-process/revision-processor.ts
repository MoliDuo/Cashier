import type {
  LedgerProjectionPort,
  RevisionProcessingRequestContract,
  RevisionProcessingContextContract,
  RevisionProcessingResultContract,
  RevisionProcessorPort,
  SettingsPort,
  SourceDocumentPort,
} from "@/application/contracts";
import { LedgerMainCurrencyChangedError } from "@/application/contracts";
import { NotFoundError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { logIdentifier } from "@/lib/security/log-identifier";
import type { AIContext } from "@/lib/tasks/types";
import { compare } from "@/lib/money/decimal";
import { convertWithRates, type ExchangeRates } from "@/modules/currency/domain/rate-calculation";
import {
  buildEntriesForInsert,
  getEntryFallbackDate,
  validateEntries,
} from "@/modules/source-document/application/parse-source-document/entry-builder";
import { runParsePipeline } from "@/modules/source-document/application/parse-source-document/pipeline";
import { toParseSourceDocumentOutput } from "@/modules/source-document/application/parse-source-document/result-mapper";
import {
  ProcessingCancelledError,
  ProcessingFailure,
  throwIfProcessingCancelled,
  type InvalidDiagnostic,
} from "@/modules/source-document/application/parse-source-document/contracts";
import { normalizeFailureReason } from "@/modules/source-document/failure-reason-policy";
import {
  isFailedLoadImageResult,
  isSuccessfulLoadImageResult,
  type LoadImageResult,
} from "./stored-image-loader";
import { createDateOrganizationSuggestion } from "@/modules/source-document/date-organization";

export interface CurrentRevisionProcessorOptions {
  createAIContext: (signal: AbortSignal) => AIContext;
  loadContext: (
    request: RevisionProcessingRequestContract
  ) => Promise<RevisionProcessingContextContract>;
  getSettings: SettingsPort["get"];
  loadStoredFiles: (ledgerId: string, storedFileIds: string[]) => Promise<LoadImageResult[]>;
  getRates: (date: string) => Promise<ExchangeRates>;
  recordProcessingFailure: SourceDocumentPort["recordProcessingFailure"];
  activateRevision: LedgerProjectionPort["activateRevision"];
}

export class CurrentRevisionProcessor implements RevisionProcessorPort {
  constructor(private readonly options: CurrentRevisionProcessorOptions) {}

  private failureLogContext(
    request: RevisionProcessingRequestContract,
    failureCode: InvalidDiagnostic
  ): Record<string, unknown> {
    return {
      ledgerSubject: logIdentifier("ledger", request.ledgerId),
      sourceDocumentSubject: logIdentifier("source-document", request.sourceDocumentId),
      revisionSubject: logIdentifier("revision", request.revisionId),
      failureCode,
    };
  }

  async process(
    request: RevisionProcessingRequestContract
  ): Promise<RevisionProcessingResultContract> {
    const signal = request.signal;
    throwIfProcessingCancelled(signal);
    const [context, ledgerSettings] = await Promise.all([
      this.options.loadContext(request),
      this.options.getSettings(request.ledgerId),
    ]);
    const { revision, document, storedFileIds, categories } = context;
    if (revision == null || document == null) throw new NotFoundError("Pending revision");
    if (
      document.activeRevisionId === request.revisionId &&
      revision.processingStatus === "completed"
    ) {
      return { processingStatus: "completed", completion: "residual" };
    }
    if (document.latestSubmissionRevisionId !== request.revisionId) {
      throw new Error("Revision processing request is stale");
    }
    throwIfProcessingCancelled(signal);

    const loadedEvidence = await this.options.loadStoredFiles(request.ledgerId, storedFileIds);
    throwIfProcessingCancelled(signal);
    const failedEvidence = loadedEvidence.filter(isFailedLoadImageResult);
    if (failedEvidence.length > 0) {
      throw new ProcessingFailure(
        "storage_failure",
        `Failed to load ${failedEvidence.length} source document evidence file(s)`,
        { cause: failedEvidence[0]?.error }
      );
    }
    const evidence = loadedEvidence.filter(isSuccessfulLoadImageResult);
    const ai = this.options.createAIContext(signal);
    const pipeline = await runParsePipeline(
      {
        ...(revision.inputText == null ? {} : { text: revision.inputText }),
        ...(evidence.length === 0
          ? {}
          : { evidence: { images: evidence.map((item) => ({ dataUrl: item.dataUrl })) } }),
        categories,
        ...(ledgerSettings?.aiCustomPrompt !== undefined
          ? { settings: { aiCustomPrompt: ledgerSettings.aiCustomPrompt } }
          : { settings: {} }),
        ...(ledgerSettings?.aiLanguage !== undefined
          ? { aiLanguage: ledgerSettings.aiLanguage }
          : {}),
        ...(ledgerSettings?.currencies !== undefined
          ? { preferredCurrencies: ledgerSettings.currencies }
          : {}),
      },
      {
        signal,
        ai,
      }
    );
    throwIfProcessingCancelled(signal);
    const output = toParseSourceDocumentOutput(pipeline);
    if (output.verificationStatus !== "passed") {
      const failureMessage = normalizeFailureReason(output.reason);
      logger.warn(
        this.failureLogContext(request, output.diagnostic),
        "Revision could not be parsed"
      );
      const preserved = await this.options.recordProcessingFailure({
        ...request,
        failureKind: "invalid_input",
        failureMessage,
        failureCode: output.diagnostic,
      });
      if (!preserved) {
        throw new ProcessingCancelledError();
      }
      return {
        processingStatus: "failed",
        ...(failureMessage == null ? {} : { failureMessage }),
        completion: "atomic",
      };
    }

    const validation = validateEntries(output.ledgerEntries);
    throwIfProcessingCancelled(signal);
    if (!validation.isValid) {
      logger.warn(
        {
          ...this.failureLogContext(request, "entry_validation_failed"),
          validationReason: validation.reason ?? null,
        },
        "Revision entries failed validation; no entries were recorded"
      );
      const preserved = await this.options.recordProcessingFailure({
        ...request,
        failureKind: "invalid_input",
        failureMessage: null,
        failureCode: "entry_validation_failed",
      });
      if (!preserved) {
        throw new ProcessingCancelledError();
      }
      return { processingStatus: "failed", completion: "atomic" };
    }
    const { fallbackDate } = getEntryFallbackDate(revision.inputDocumentDate);
    const validEntries = output.ledgerEntries.filter(
      (entry) => compare(entry.amount, "0") > 0 || entry.isAdjustment === true
    );
    const ratesByDate = new Map<string, Promise<ExchangeRates>>();
    let currentSettings = ledgerSettings;

    for (let attempt = 0; attempt < 3; attempt++) {
      throwIfProcessingCancelled(signal);
      if (attempt > 0) {
        currentSettings = await this.options.getSettings(request.ledgerId);
        throwIfProcessingCancelled(signal);
      }
      const mainCurrency = currentSettings?.mainCurrency ?? "CNY";

      try {
        const entries = await buildEntriesForInsert({
          validEntries,
          categories,
          sourceDocumentId: request.sourceDocumentId,
          ledgerId: request.ledgerId,
          mainCurrency,
          fallbackDate,
          convertAmount: async ({ amount, fromCurrency, toCurrency, date }) => {
            const rateDate = date ?? "latest";
            let ratesPromise = ratesByDate.get(rateDate);
            if (ratesPromise == null) {
              ratesPromise = this.options.getRates(date);
              ratesByDate.set(rateDate, ratesPromise);
            }
            return convertWithRates(amount, await ratesPromise, fromCurrency, toCurrency);
          },
        });
        throwIfProcessingCancelled(signal);
        const entryInputs = entries.map((entry) => ({
          id: entry.id,
          categoryId: entry.categoryId,
          amount: entry.amount,
          currency: entry.currency,
          itemName: entry.itemName,
          description: entry.description,
          convertedAmount: entry.convertedAmount,
          exchangeRate: entry.exchangeRate,
          createdAt: entry.entryDate,
          ...(entry.dateHint == null ? {} : { dateHint: entry.dateHint }),
        }));

        const dateOrganizationSuggestion = createDateOrganizationSuggestion({
          referenceDate: revision.inputDateReference,
          sourceDocumentDate: fallbackDate,
          entries,
        });

        throwIfProcessingCancelled(signal);
        const activated = await this.options.activateRevision({
          ...request,
          expectedMainCurrency: mainCurrency,
          ...(output.title == null ? {} : { title: output.title }),
          entries: entryInputs,
          dateOrganizationSuggestion,
        });
        if (!activated) {
          throw new ProcessingCancelledError();
        }
        return { processingStatus: "completed", completion: "atomic" };
      } catch (error) {
        if (!(error instanceof LedgerMainCurrencyChangedError)) throw error;
      }
    }

    throw new ProcessingFailure(
      "exchange_rate_failure",
      "Ledger currency kept changing while the revision was being committed"
    );
  }
}
