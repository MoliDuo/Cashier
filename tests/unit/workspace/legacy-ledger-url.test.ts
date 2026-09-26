import { describe, expect, it } from "vitest";
import { legacyLedgerHref } from "@/modules/workspace/legacy-ledger-url";

const href = (query: string) => legacyLedgerHref(new URLSearchParams(query));

describe("legacyLedgerHref", () => {
  it("sends the bare home page to 流水", () => {
    expect(href("")).toBe("/stream");
  });

  it("drops an unknown tab to 流水", () => {
    expect(href("tab=nope")).toBe("/stream");
  });

  it("unprefixes the tab's own filters and drops the other tab's", () => {
    expect(
      href(
        "tab=details&detailsPeriod=custom&detailsStartDate=2026-01-01&detailsEndDate=2026-01-31&detailsCategoryId=c1&streamSearch=coffee"
      )
    ).toBe("/details?period=custom&startDate=2026-01-01&endDate=2026-01-31&categoryId=c1");
    expect(href("tab=stream&streamSearch=coffee&streamStatuses=failed")).toBe(
      "/stream?statuses=failed&search=coffee"
    );
  });

  it("renames the stats state", () => {
    expect(href("tab=stats&statsRange=year&statsOffset=-1&statsView=trend")).toBe(
      "/stats?range=year&offset=-1&view=trend"
    );
  });

  it("keeps an open record sheet", () => {
    expect(href("tab=stream&detailType=source-document&detailId=doc-1")).toBe(
      "/stream?detail=doc-1"
    );
    expect(href("detailType=ledger-entry&detailId=e-1")).toBe("/stream");
  });

  it("lands settings without a query", () => {
    expect(href("tab=settings&streamSearch=x")).toBe("/settings");
  });
});
