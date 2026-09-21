import {
  applicationContractSuite,
  type ApplicationContractHarness,
} from "../../helpers/application-contract-suites";
import {
  supportedSourceDocumentActions,
  type AuthorizedFileReadContract,
  type ProcessingCompletionContract,
  type ProcessingJobContract,
  type StoredFileContract,
  type StoredFilePort,
  type UploadFinalizationContract,
  type UploadPlanContract,
} from "@/application/contracts";

function createCurrentRuntimeHarness(): ApplicationContractHarness {
  const files = new Map<string, StoredFileContract>();
  const completed = new Map<string, ProcessingCompletionContract>();
  const dispatched = new Set<string>();
  const plan: UploadPlanContract = {
    id: "upload-session-1",
    expiresAt: "2026-07-13T01:00:00.000Z",
    targets: [{ id: "target-1" }],
    finalizationToken: "finalize-token",
    maxFiles: 10,
    maxBytesPerFile: 10 * 1024 * 1024,
  };
  const storedFile: StoredFileContract = {
    id: "file_opaque_1",
    ownerLedgerId: "ledger-1",
    metadata: { contentType: "image/jpeg", byteSize: 3, originalFilename: null, checksum: null },
    createdAt: "2026-07-13T00:00:00.000Z",
  };
  const filePort: StoredFilePort = {
    async createUploadPlan() {
      return plan;
    },
    async finalizeUpload(input: UploadFinalizationContract) {
      if (input.uploadSessionId !== plan.id || input.finalizationToken !== plan.finalizationToken)
        return [];
      files.set(storedFile.id, storedFile);
      return [storedFile];
    },
    async readAuthorized(ledgerId, fileId): Promise<AuthorizedFileReadContract | null> {
      const file = files.get(fileId);
      return file != null && file.ownerLedgerId === ledgerId
        ? { file, body: new Uint8Array([1, 2, 3]) }
        : null;
    },
  };

  return {
    sourceDocumentActions: supportedSourceDocumentActions,
    files: filePort,
    processing: {
      async dispatch(job: ProcessingJobContract) {
        dispatched.add(job.id);
      },
      async claim(jobId) {
        if (!dispatched.has(jobId)) return null;
        return {
          ledgerId: "ledger-1",
          job: {
            id: jobId,
            sourceDocumentId: "document-1",
            revisionId: "revision-1",
            requestedAt: "2026-07-13T00:00:00.000Z",
            attemptNumber: 1,
          },
          claimToken: "claim-1",
          expiresAt: "2026-07-13T00:05:00.000Z",
        };
      },
      async renew(_jobId, _claimToken) {
        return "2026-07-13T00:05:00.000Z";
      },
      async complete(result) {
        if (completed.has(result.jobId)) return false;
        completed.set(result.jobId, result);
        return true;
      },
    },
    plan: () => filePort.createUploadPlan("ledger-1"),
    finalize: (currentPlan) =>
      filePort.finalizeUpload({
        uploadSessionId: currentPlan.id,
        finalizationToken: currentPlan.finalizationToken,
        targetIds: ["target-1"],
      }),
    read: (file) => filePort.readAuthorized("ledger-1", file.id),
    dispatch: (job) =>
      dispatched.has(job.id)
        ? Promise.resolve()
        : Promise.resolve(dispatched.add(job.id)).then(() => undefined),
    completions: () => [...completed.values()],
  };
}

applicationContractSuite(
  "current Postgres/local-file/in-process contract composition",
  createCurrentRuntimeHarness
);
