import { describe, expect, it } from "vitest";
import {
  isLedgerTab,
  ledgerPageFor,
  ledgerTabFromPathname,
  ledgerTabHref,
  readRecordsView,
} from "@/lib/ledger-tabs";

describe("ledger tabs helpers", () => {
  it("reads the route from its pathname", () => {
    expect(ledgerTabFromPathname("/stats")).toBe("stats");
    expect(ledgerTabFromPathname("/records/")).toBe("records");
  });

  it("falls back to 账目 for anything that is not a ledger route", () => {
    expect(ledgerTabFromPathname("/")).toBe("records");
    expect(ledgerTabFromPathname("/stream")).toBe("records");
    expect(ledgerTabFromPathname(null)).toBe("records");
  });

  it("reads 账目's view, by bill unless entries are asked for", () => {
    expect(readRecordsView(new URLSearchParams(""))).toBe("documents");
    expect(readRecordsView(new URLSearchParams("view=entries"))).toBe("entries");
    expect(readRecordsView(new URLSearchParams("view=other"))).toBe("documents");
    expect(ledgerPageFor("records", new URLSearchParams("view=entries"))).toBe("entries");
    expect(ledgerPageFor("stats", new URLSearchParams("view=entries"))).toBe("stats");
  });

  it("builds a route href with its query", () => {
    expect(ledgerTabHref("settings")).toBe("/settings");
    expect(ledgerTabHref("records", "view=entries")).toBe("/records?view=entries");
  });

  it("validates ledger route values", () => {
    expect(isLedgerTab("settings")).toBe(true);
    expect(isLedgerTab("stream")).toBe(false);
    expect(isLedgerTab(null)).toBe(false);
  });
});
