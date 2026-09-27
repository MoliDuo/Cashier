import { describe, expect, it } from "vitest";
import { legacyLedgerHref } from "@/modules/workspace/legacy-ledger-url";

const href = (query: string) => legacyLedgerHref(new URLSearchParams(query));

describe("legacyLedgerHref", () => {
  it("sends the bare home page to 账目", () => {
    expect(href("")).toBe("/records");
  });

  it("drops an unknown tab to 账目", () => {
    expect(href("tab=nope")).toBe("/records");
  });

  it("lands 明细 on 账目's entries view with its own filters, dropping the other tab's", () => {
    expect(
      href(
        "tab=details&detailsPeriod=custom&detailsStartDate=2026-01-01&detailsEndDate=2026-01-31&detailsCategoryId=c1&streamSearch=coffee"
      )
    ).toBe(
      "/records?view=entries&categoryId=c1&period=custom&startDate=2026-01-01&endDate=2026-01-31"
    );
    expect(href("tab=stream&streamSearch=coffee&streamStatuses=failed")).toBe(
      "/records?statuses=failed&search=coffee"
    );
  });

  it("renames the stats state", () => {
    expect(href("tab=stats&statsRange=year&statsOffset=-1&statsView=trend")).toBe(
      "/stats?range=year&offset=-1&view=trend"
    );
  });

  it("keeps an open record sheet", () => {
    expect(href("tab=stream&detailType=source-document&detailId=doc-1")).toBe(
      "/records?detail=doc-1"
    );
    expect(href("detailType=ledger-entry&detailId=e-1")).toBe("/records");
  });

  it("lands settings without a query", () => {
    expect(href("tab=settings&streamSearch=x")).toBe("/settings");
  });
});
