import { describe, expect, it } from "vitest";
import { logIdentifier } from "@/lib/security/log-identifier";

describe("logIdentifier", () => {
  it("pseudonymises personal data stably, whatever case or padding it arrives in", () => {
    const first = logIdentifier("email", "User@Example.com");
    const second = logIdentifier("email", " user@example.com ");

    expect(first).toBe(second);
    expect(first).toMatch(/^email:[a-f0-9]{16}$/);
    expect(first).not.toContain("example.com");
    expect(logIdentifier("ip", "203.0.113.7")).not.toContain("203.0.113.7");
  });

  it("leaves a surrogate key legible, so a log line can be looked up", () => {
    const id = "8f4c1a2e-0d3b-4f5a-9c6d-7e8f90a1b2c3";

    expect(logIdentifier("source-document", id)).toBe(`source-document:${id}`);
    expect(logIdentifier("ledger", id)).toBe(`ledger:${id}`);
  });
});
