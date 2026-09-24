import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RevisionProcessingResultContract } from "@/server/processing/types";
import { ProcessingCancelledError } from "@/modules/source-document/domain/parse/contracts";

const job = {
  id: "job",
  sourceDocumentId: "document",
  revisionId: "revision",
  requestedAt: "2026-09-01T00:00:00Z",
  attemptNumber: 1,
};

const { complete, process, recordProcessingFailure } = vi.hoisted(() => ({
  complete: vi.fn(),
  process: vi.fn(),
  recordProcessingFailure: vi.fn(),
}));

vi.mock("@/server/processing/jobs", () => ({
  claimProcessingJob: vi.fn(async () => ({ job, ledgerId: "ledger", claimToken: "token" })),
  renewProcessingJobLease: vi.fn(async () => null),
  completeProcessingJob: complete,
}));
vi.mock("@/server/processing/revision-processor", () => ({ processRevision: process }));
vi.mock("@/modules/source-document/server/revisions", () => ({ recordProcessingFailure }));

import { executeProcessingJob } from "@/server/processing/execute-job";

describe("single processing job completion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    complete.mockResolvedValue(true);
    recordProcessingFailure.mockResolvedValue(true);
  });

  it.each(["completed", "failed"] as const)(
    "does not complete an atomic %s twice",
    async (processingStatus) => {
      process.mockResolvedValue({
        processingStatus,
        completion: "atomic",
      } satisfies RevisionProcessingResultContract);
      await expect(executeProcessingJob(job)).resolves.toBe(true);
      expect(complete).not.toHaveBeenCalled();
      expect(recordProcessingFailure).not.toHaveBeenCalled();
    }
  );

  it("completes a residual job with its claim token", async () => {
    process.mockResolvedValue({ processingStatus: "completed", completion: "residual" });
    await executeProcessingJob(job);
    expect(complete).toHaveBeenCalledExactlyOnceWith({
      jobId: "job",
      claimToken: "token",
      processingStatus: "completed",
    });
  });

  it("preserves an error atomically without another completion", async () => {
    process.mockRejectedValue(new Error("failed"));
    await executeProcessingJob(job);
    expect(recordProcessingFailure).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        failureKind: "processing_error",
        lease: { jobId: "job", claimToken: "token" },
      })
    );
    expect(complete).not.toHaveBeenCalled();
  });

  it("leaves a cancelled claim untouched", async () => {
    process.mockRejectedValue(new ProcessingCancelledError());
    await executeProcessingJob(job);
    expect(complete).not.toHaveBeenCalled();
    expect(recordProcessingFailure).not.toHaveBeenCalled();
  });
});
