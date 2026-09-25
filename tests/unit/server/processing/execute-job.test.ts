import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RevisionProcessingResultContract } from "@/server/processing/types";
import { ProcessingCancelledError } from "@/modules/source-document/domain/parse/contracts";

const job = {
  sourceDocumentId: "document",
  revisionId: "revision",
  requestedAt: "2026-09-01T00:00:00Z",
};

const { process, recordProcessingFailure } = vi.hoisted(() => ({
  process: vi.fn(),
  recordProcessingFailure: vi.fn(),
}));

vi.mock("@/server/processing/jobs", () => ({
  claimProcessingJob: vi.fn(async () => ({
    job,
    ledgerId: "ledger",
    claimToken: "token",
    attempt: 1,
  })),
  renewProcessingJobLease: vi.fn(async () => null),
}));
vi.mock("@/server/processing/revision-processor", () => ({ processRevision: process }));
vi.mock("@/modules/source-document/server/revisions", () => ({ recordProcessingFailure }));

import { claimProcessingJob } from "@/server/processing/jobs";
import { executeProcessingJob } from "@/server/processing/execute-job";

describe("single processing job completion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    recordProcessingFailure.mockResolvedValue(true);
  });

  it.each(["completed", "failed"] as const)(
    "records nothing more after a %s outcome",
    async (processingStatus) => {
      process.mockResolvedValue({ processingStatus } satisfies RevisionProcessingResultContract);
      await expect(executeProcessingJob(job)).resolves.toBe(true);
      expect(recordProcessingFailure).not.toHaveBeenCalled();
    }
  );

  it("records an error under the attempt's lease", async () => {
    process.mockRejectedValue(new Error("failed"));
    await executeProcessingJob(job);
    expect(claimProcessingJob).toHaveBeenCalledExactlyOnceWith("revision");
    expect(recordProcessingFailure).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        failureKind: "processing_error",
        lease: { revisionId: "revision", claimToken: "token" },
      })
    );
  });

  it("leaves a cancelled claim untouched", async () => {
    process.mockRejectedValue(new ProcessingCancelledError());
    await executeProcessingJob(job);
    expect(recordProcessingFailure).not.toHaveBeenCalled();
  });
});
