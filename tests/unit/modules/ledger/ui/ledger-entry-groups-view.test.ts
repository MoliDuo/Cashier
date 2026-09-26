import { describe, expect, it } from "vitest";
import type { LedgerEntry } from "@/modules/ledger/contracts";
import { flattenLedgerEntryGroups } from "@/modules/ledger/ui/LedgerEntryGroupsView";

function entry(id: string): LedgerEntry {
  return { id } as LedgerEntry;
}

describe("ledger entry group virtualization rows", () => {
  it("flattens headers and entries with stable unique keys", () => {
    const rows = flattenLedgerEntryGroups([
      { title: "Today", total: "3", items: [entry("entry-1"), entry("entry-2")] },
      { title: "Yesterday", total: "4", items: [entry("entry-3")] },
    ]);

    expect(rows.map((row) => row.kind)).toEqual(["header", "entry", "entry", "header", "entry"]);
    expect(rows.map((row) => row.key)).toEqual([
      "header:0:Today",
      "entry:entry-1",
      "entry:entry-2",
      "header:1:Yesterday",
      "entry:entry-3",
    ]);
  });
});
