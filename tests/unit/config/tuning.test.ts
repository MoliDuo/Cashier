import { describe, expect, it } from "vitest";
import {
  AI_ATTEMPT_DEADLINE_MS,
  AI_CATEGORY_REQUEST_TIMEOUT_MS,
  AI_REQUEST_TIMEOUT_MS,
  LEASE_DURATION_MS,
  LEASE_HEARTBEAT_MS,
} from "@/config/tuning";

describe("tuning relations", () => {
  it("keeps a lease through a late heartbeat", () => {
    expect(LEASE_DURATION_MS).toBeGreaterThanOrEqual(3 * LEASE_HEARTBEAT_MS);
  });

  it("lets one model request finish inside the parse deadline", () => {
    expect(AI_REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(AI_ATTEMPT_DEADLINE_MS);
    expect(AI_CATEGORY_REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(AI_ATTEMPT_DEADLINE_MS);
  });
});
