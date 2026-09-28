"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { RECORDS_VIEW_PARAM, readRecordsView, type RecordsView } from "@/lib/ledger-tabs";
import { pushLedgerUrl } from "../../ledger-url-navigation";
import { DocumentsView } from "./DocumentsView";
import { EntriesView } from "./EntriesView";
import { ledgerPageCopy } from "@/copy/app";

/**
 * 账目: the ledger's records, by bill or by entry. The two views share the
 * period and the filters in the URL, so switching keeps what is being looked at.
 */
export function RecordsRoute() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const view = readRecordsView(searchParams);

  const changeView = (next: RecordsView) => {
    if (next === view) return;
    const params = new URLSearchParams(searchParams.toString());
    if (next === "documents") params.delete(RECORDS_VIEW_PARAM);
    else params.set(RECORDS_VIEW_PARAM, next);
    pushLedgerUrl(pathname, params, "filter");
  };

  return (
    <>
      <SegmentedControl
        className="mb-3"
        label={ledgerPageCopy.recordsView}
        value={view}
        onChange={changeView}
        options={[
          { value: "documents", label: ledgerPageCopy.byDocument },
          { value: "entries", label: ledgerPageCopy.byEntry },
        ]}
      />
      {view === "entries" ? <EntriesView /> : <DocumentsView />}
    </>
  );
}
