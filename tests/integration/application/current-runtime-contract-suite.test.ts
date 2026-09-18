import { applicationContractSuite } from "../../helpers/application-contract-suites";
import { createTestUserWithLedger, testBookId } from "../../helpers/schema-setup";
import { getTestDb } from "../../setup";
import { supportedSourceDocumentActions } from "@/application/contracts";
import type {
  ProcessingCompletionContract,
  ProcessingJobContract,
  UploadPlanContract,
} from "@/application/contracts";
import { createStoredFileAdapter } from "@/application/adapters/storage";
import {
  PostgresProcessingJobAdapter,
  postgresRevisionAdapter,
} from "@/application/adapters/postgres";

class ContractFileStore {
  readonly files = new Map<string, Buffer>();

  async upload(key: string, data: Buffer): Promise<string> {
    this.files.set(key, Buffer.from(data));
    return `/api/uploads/${key}`;
  }

  async download(key: string): Promise<Buffer> {
    const file = this.files.get(key);
    if (file == null) throw new Error("missing contract file");
    return Buffer.from(file);
  }

  async delete(key: string): Promise<{ success: boolean }> {
    this.files.delete(key);
    return { success: true };
  }
}

applicationContractSuite("real Postgres/object-storage/in-process adapter composition", () => {
  const db = getTestDb();
  const files = createStoredFileAdapter({ storage: new ContractFileStore() });
  const processing = new PostgresProcessingJobAdapter();
  const actualIntents = new Map<string, ProcessingJobContract>();
  const completions: ProcessingCompletionContract[] = [];
  let setupPromise: ReturnType<typeof createTestUserWithLedger> | null = null;

  function getSetup(): ReturnType<typeof createTestUserWithLedger> {
    if (setupPromise == null) {
      setupPromise = createTestUserWithLedger(db);
    }
    return setupPromise;
  }

  async function prepareIntent(job: ProcessingJobContract): Promise<ProcessingJobContract> {
    const existing = actualIntents.get(job.id);
    if (existing != null) return existing;
    const { ledgerId } = await getSetup();
    const pending = await postgresRevisionAdapter.createProcessingRevision({
      ledgerId,
      input: { text: "contract processing input", storedFileIds: [], documentDate: null },
      bookId: await testBookId(db, ledgerId),
    });
    const actual = {
      ...job,
      id: crypto.randomUUID(),
      sourceDocumentId: pending.document.id,
      revisionId: pending.revision.id,
    };
    actualIntents.set(job.id, actual);
    return actual;
  }

  const processingPort = {
    async dispatch(job: ProcessingJobContract) {
      await processing.dispatch(await prepareIntent(job));
    },
    claim: (jobId: string) => processing.claim(actualIntents.get(jobId)?.id ?? jobId),
    renew: (jobId: string, claimToken: string) =>
      processing.renew(actualIntents.get(jobId)?.id ?? jobId, claimToken),
    async complete(result: ProcessingCompletionContract) {
      const completed = await processing.complete({
        ...result,
        jobId: actualIntents.get(result.jobId)?.id ?? result.jobId,
      });
      if (completed) completions.push(result);
      return completed;
    },
  };

  async function plan(): Promise<UploadPlanContract> {
    const { ledgerId } = await getSetup();
    const bytes = Buffer.from("contract-file");
    const current = await files.createUploadPlan(ledgerId, [
      {
        contentType: "image/jpeg",
        byteSize: bytes.length,
        originalFilename: "contract.jpg",
      },
    ]);
    await files.uploadTarget({
      ledgerId,
      uploadSessionId: current.id,
      targetId: current.targets[0]!.id,
      contentType: "image/jpeg",
      body: bytes,
    });
    return current;
  }

  return {
    sourceDocumentActions: supportedSourceDocumentActions,
    files,
    processing: processingPort,
    plan,
    async finalize(current) {
      const { ledgerId } = await getSetup();
      const finalized = await files.finalizeUpload({
        ownerLedgerId: ledgerId,
        uploadSessionId: current.id,
        finalizationToken: current.finalizationToken,
        targetIds: [current.targets[0]!.id],
      });
      await postgresRevisionAdapter.createProcessingRevision({
        ledgerId,
        input: {
          text: null,
          storedFileIds: finalized.map((file) => file.id),
          documentDate: null,
        },
        bookId: await testBookId(db, ledgerId),
      });
      return finalized;
    },
    async read(file) {
      const { ledgerId } = await getSetup();
      return files.readAuthorized(ledgerId, file.id);
    },
    dispatch: (job) => processingPort.dispatch(job),
    completions: () => completions,
  };
});
