import { describe, expect, it } from "vitest";
import { isLedgerTab, ledgerTabFromPathname, ledgerTabHref } from "@/lib/ledger-tabs";

describe("ledger tabs helpers", () => {
  it("reads the tab from its route", () => {
    expect(ledgerTabFromPathname("/stats")).toBe("stats");
    expect(ledgerTabFromPathname("/details/")).toBe("details");
  });

  it("falls back to stream for anything that is not a ledger route", () => {
    expect(ledgerTabFromPathname("/")).toBe("stream");
    expect(ledgerTabFromPathname("/login")).toBe("stream");
    expect(ledgerTabFromPathname(null)).toBe("stream");
  });

  it("builds a route href with its query", () => {
    expect(ledgerTabHref("settings")).toBe("/settings");
    expect(ledgerTabHref("details", "period=lastMonth")).toBe("/details?period=lastMonth");
  });

  it("validates ledger tab values", () => {
    expect(isLedgerTab("settings")).toBe(true);
    expect(isLedgerTab("invalid")).toBe(false);
    expect(isLedgerTab(null)).toBe(false);
  });
});
