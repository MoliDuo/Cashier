export interface ApplyCategoryAssignmentsInput {
  ledgerId: string;
  jobId: string;
  sourceDocumentId: string;
  claimToken: string;
  now?: Date;
}
export type ApplyCategoryAssignmentsResult =
  | { status: "applied"; appliedCount: number; confirmedCount: number; version: number }
  | { status: "conflict" | "skipped" | "cancelled" | "claim_lost" };
