import { describe, expect, it } from "vitest";
import type { CategoryReclassificationJob } from "@/modules/ledger/contracts";
import {
  isCategoryAssignmentJobActive,
  shouldShowCategoryAssignmentStatus,
} from "@/modules/ledger/ui/category-assignment-status-visibility";

function job(overrides: Partial<CategoryReclassificationJob> = {}): CategoryReclassificationJob {
  return {
    id: "job-1",
    formatVersion: 2,
    mode: { kind: "clear" },
    status: "succeeded",
    total: 10,
    processedCount: 10,
    appliedCount: 9,
    confirmedCount: 1,
    failedCount: 0,
    conflictCount: 0,
    skippedCount: 0,
    cancelledCount: 0,
    documentTotal: 10,
    documentCompleted: 10,
    activeDocumentCount: 0,
    retryingDocumentCount: 0,
    nextRetryAt: null,
    candidateCategories: [],
    receivedCount: 10,
    errorCode: null,
    createdAt: "2026-09-14T00:00:00.000Z",
    updatedAt: "2026-09-14T00:01:00.000Z",
    completedAt: "2026-09-14T00:01:00.000Z",
    canRetryFailed: false,
    evidenceIncomplete: false,
    ...overrides,
  };
}

describe("isCategoryAssignmentJobActive", () => {
  it("counts every in-flight status and nothing else", () => {
    expect(isCategoryAssignmentJobActive(job({ status: "preparing" }))).toBe(true);
    expect(isCategoryAssignmentJobActive(job({ status: "pending" }))).toBe(true);
    expect(isCategoryAssignmentJobActive(job({ status: "running" }))).toBe(true);
    expect(isCategoryAssignmentJobActive(job({ status: "succeeded" }))).toBe(false);
    expect(isCategoryAssignmentJobActive(job({ status: "partial" }))).toBe(false);
    expect(isCategoryAssignmentJobActive(job({ status: "failed" }))).toBe(false);
    expect(isCategoryAssignmentJobActive(job({ status: "cancelled" }))).toBe(false);
    expect(isCategoryAssignmentJobActive(null)).toBe(false);
  });
});

describe("shouldShowCategoryAssignmentStatus", () => {
  it("stays quiet for a finished run this page never watched", () => {
    expect(
      shouldShowCategoryAssignmentStatus({
        job: job(),
        isReadError: false,
        wasActive: false,
        dismissed: false,
        readFailureDismissed: false,
      })
    ).toBe(false);
  });

  it("keeps reporting a run while it is still moving", () => {
    expect(
      shouldShowCategoryAssignmentStatus({
        job: job({ status: "running" }),
        isReadError: false,
        wasActive: true,
        dismissed: false,
        readFailureDismissed: false,
      })
    ).toBe(true);
  });

  it("holds a watched run's outcome until the reader closes it", () => {
    const watched = {
      job: job(),
      isReadError: false,
      wasActive: true,
      dismissed: false,
      readFailureDismissed: false,
    };
    expect(shouldShowCategoryAssignmentStatus(watched)).toBe(true);
    expect(shouldShowCategoryAssignmentStatus({ ...watched, dismissed: true })).toBe(false);
  });

  it("shows an active run even after a dismissal, so Stop stays reachable", () => {
    expect(
      shouldShowCategoryAssignmentStatus({
        job: job({ status: "running" }),
        isReadError: false,
        wasActive: true,
        dismissed: true,
        readFailureDismissed: false,
      })
    ).toBe(true);
  });

  it("reports a read failure until the reader closes it", () => {
    const failed = {
      job: null,
      isReadError: true,
      wasActive: false,
      dismissed: false,
      readFailureDismissed: false,
    };
    expect(shouldShowCategoryAssignmentStatus(failed)).toBe(true);
    expect(shouldShowCategoryAssignmentStatus({ ...failed, readFailureDismissed: true })).toBe(
      false
    );
  });

  it("lets a run announce itself after a dismissed read failure", () => {
    expect(
      shouldShowCategoryAssignmentStatus({
        job: job({ id: "job-2", status: "running" }),
        isReadError: false,
        wasActive: true,
        dismissed: false,
        readFailureDismissed: true,
      })
    ).toBe(true);
  });

  it("renders nothing when there is no job and no failure", () => {
    expect(
      shouldShowCategoryAssignmentStatus({
        job: null,
        isReadError: false,
        wasActive: false,
        dismissed: false,
        readFailureDismissed: false,
      })
    ).toBe(false);
  });
});
