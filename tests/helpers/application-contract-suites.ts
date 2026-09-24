import { describe, expect, it } from "vitest";
import type {
  AuthorizedFileReadContract,
  ProcessingCompletionContract,
  ProcessingJobContract,
  StoredFileContract,
  StoredFilePort,
  UploadPlanContract,
} from "@/application/contracts";
import type { processingJobs } from "./processing-jobs";

export interface ApplicationContractHarness {
  sourceDocumentActions(input: {
    activeRevisionId: string | null;
    latestSubmissionStatus: "processing" | "completed" | "failed" | "cancelled" | null;
    hasSubmissionInput: boolean;
    deleted?: boolean;
  }): readonly string[];
  files: StoredFilePort;
  processing: Pick<ReturnType<typeof processingJobs>, "claim" | "renew" | "complete">;
  plan(): Promise<UploadPlanContract>;
  finalize(plan: UploadPlanContract): Promise<readonly StoredFileContract[]>;
  read(file: StoredFileContract): Promise<AuthorizedFileReadContract | null>;
  dispatch(job: ProcessingJobContract): Promise<void>;
  completions(): readonly ProcessingCompletionContract[];
}

/** Runs the shared file and processing contract against a real runtime harness. */
export function applicationContractSuite(
  name: string,
  create: () => ApplicationContractHarness | Promise<ApplicationContractHarness>
): void {
  describe(name, () => {
    it("preserves active revisions and only exposes actions for a terminal pending revision", async () => {
      const harness = await create();
      expect(
        harness.sourceDocumentActions({
          activeRevisionId: "revision-1",
          latestSubmissionStatus: "failed",
          hasSubmissionInput: true,
        })
      ).toContain("retry");
      expect(
        harness.sourceDocumentActions({
          activeRevisionId: "revision-1",
          latestSubmissionStatus: "processing",
          hasSubmissionInput: true,
        })
      ).toEqual(["cancel_processing", "retry", "edit_retry", "delete"]);
    });

    it("finalizes an upload into opaque stored-file identities and authorizes reads", async () => {
      const harness = await create();
      const plan = await harness.plan();
      const files = await harness.finalize(plan);
      expect(files).toHaveLength(1);
      expect(files[0]?.id).not.toContain("/");
      await expect(harness.read(files[0]!)).resolves.toMatchObject({ file: files[0] });
    });

    it("does not reveal a file when authorization is denied", async () => {
      const harness = await create();
      const files = await harness.finalize(await harness.plan());
      await expect(
        harness.files.readAuthorized("00000000-0000-4000-8000-000000000099", files[0]!.id)
      ).resolves.toBeNull();
    });

    it("makes duplicate processing dispatch and recovery completion harmless", async () => {
      const harness = await create();
      const job: ProcessingJobContract = {
        id: "job-1",
        sourceDocumentId: "document-1",
        revisionId: "revision-1",
        requestedAt: "2026-07-13T00:00:00.000Z",
        attemptNumber: 1,
      };
      await harness.dispatch(job);
      await harness.dispatch(job);
      const claim = await harness.processing.claim(job.id);
      expect(claim).not.toBeNull();
      await harness.processing.complete({
        jobId: job.id,
        claimToken: claim!.claimToken,
        processingStatus: "completed",
      });
      await harness.processing.complete({
        jobId: job.id,
        claimToken: claim!.claimToken,
        processingStatus: "completed",
      });
      expect(harness.completions()).toHaveLength(1);
    });
  });
}
