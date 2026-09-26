import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AI_CATEGORY_REQUEST_TIMEOUT_MS,
  AI_REQUEST_TIMEOUT_MS,
  AI_REVISION_DEADLINE_MS,
  CATEGORY_RUN_BUDGET_MS,
  FUNCTION_MAX_DURATION_SECONDS,
  LEASE_DURATION_MS,
  LEASE_HEARTBEAT_MS,
  OUTCOME_RESERVE_MS,
} from "@/config/tuning";

const AI_RUNNING_ROUTES = [
  "src/app/(protected)/(ledger)/stream/page.tsx",
  "src/app/(protected)/(ledger)/details/page.tsx",
  "src/app/(protected)/(ledger)/stats/page.tsx",
  "src/app/(protected)/(ledger)/settings/page.tsx",
  "src/app/api/ledger-queries/route.ts",
  "src/app/api/v1/source-documents/route.ts",
  "src/app/api/cron/daily/route.ts",
];

const budgetMs = FUNCTION_MAX_DURATION_SECONDS * 1000;

describe("function time budget", () => {
  it.each(AI_RUNNING_ROUTES)("%s exports the shared maxDuration", (file) => {
    const source = readFileSync(file, "utf8");
    expect(source).toMatch(
      new RegExp(`export const maxDuration = ${FUNCTION_MAX_DURATION_SECONDS};`)
    );
  });

  it("ends a parse early enough to record its outcome", () => {
    expect(AI_REVISION_DEADLINE_MS).toBeLessThanOrEqual(budgetMs - 20_000);
  });

  it("lets the last document a category run claims finish its request", () => {
    expect(CATEGORY_RUN_BUDGET_MS + AI_CATEGORY_REQUEST_TIMEOUT_MS).toBeLessThan(budgetMs);
  });

  it("lets one model request finish inside the parse deadline", () => {
    expect(AI_REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(AI_REVISION_DEADLINE_MS);
    expect(AI_REVISION_DEADLINE_MS + OUTCOME_RESERVE_MS).toBeLessThanOrEqual(budgetMs);
  });

  it("keeps a lease through a late heartbeat but frees a killed worker's within the budget", () => {
    expect(LEASE_DURATION_MS).toBeGreaterThanOrEqual(3 * LEASE_HEARTBEAT_MS);
    expect(LEASE_DURATION_MS).toBeLessThanOrEqual(budgetMs);
  });
});
