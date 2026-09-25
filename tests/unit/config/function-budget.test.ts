import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AI_CATEGORY_REQUEST_TIMEOUT_MS,
  AI_REVISION_DEADLINE_MS,
  CATEGORY_RUN_BUDGET_MS,
  FUNCTION_MAX_DURATION_SECONDS,
} from "@/config/tuning";

const AI_RUNNING_ROUTES = [
  "src/app/(protected)/page.tsx",
  "src/app/api/ledger-queries/route.ts",
  "src/app/api/v1/source-documents/route.ts",
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
});
