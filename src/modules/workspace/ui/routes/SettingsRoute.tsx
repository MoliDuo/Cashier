"use client";
import { SettingsTab } from "@/modules/ledger/ui/SettingsTab";
import { UNCATEGORIZED_SENTINEL } from "@/modules/ledger/contract-schemas";
import { RECORDS_VIEW_PARAM } from "@/lib/ledger-tabs";
import { useLedgerNavigation } from "../../hooks/useLedgerNavigation";
import { useWorkspaceStore } from "../../store";
import { useLedgerWorkspace } from "../ledger-workspace-context";

interface SettingsRouteProps {
  userEmail?: string;
}

/** 设置. The account facts come from the page's own server render. */
export function SettingsRoute({ userEmail }: SettingsRouteProps) {
  const { ledger, categories, books } = useLedgerWorkspace();
  const { navigate } = useLedgerNavigation();
  const recordsQuery = useWorkspaceStore((state) => state.routeQueries.records ?? "");

  // After a preset switch the reader lands on 账目's entries to check them. The
  // switch can retire the category they were filtered by, which is then
  // dropped rather than leaving an empty list.
  const goToEntries = (validCategoryIds: readonly string[]) => {
    const query = new URLSearchParams(recordsQuery);
    query.set(RECORDS_VIEW_PARAM, "entries");
    const categoryId = query.get("categoryId");
    if (
      categoryId != null &&
      categoryId !== UNCATEGORIZED_SENTINEL &&
      !validCategoryIds.includes(categoryId)
    ) {
      query.delete("categoryId");
    }
    navigate("records", query);
  };

  return (
    <SettingsTab
      ledger={ledger}
      initialCategories={categories}
      initialBooks={books}
      {...(userEmail !== undefined ? { userEmail } : {})}
      onGoToDetails={goToEntries}
    />
  );
}
