"use client";
import { SettingsTab } from "@/modules/ledger/ui/SettingsTab";
import { UNCATEGORIZED_SENTINEL } from "@/modules/ledger/contract-schemas";
import { useLedgerNavigation } from "../../hooks/useLedgerNavigation";
import { useWorkspaceStore } from "../../store";
import { useLedgerWorkspace } from "../ledger-workspace-context";

interface SettingsRouteProps {
  userEmail?: string;
  hasPassword: boolean;
  passwordUpdatedAt: string | null;
}

/** 设置. The account facts come from the page's own server render. */
export function SettingsRoute({ userEmail, hasPassword, passwordUpdatedAt }: SettingsRouteProps) {
  const { ledger, categories, books } = useLedgerWorkspace();
  const { navigate } = useLedgerNavigation();
  const detailsQuery = useWorkspaceStore((state) => state.routeQueries.details ?? "");

  // A preset switch can retire the category 明细 was filtered by; the reader
  // then lands on 明细 without it rather than on an empty list.
  const goToDetails = (validCategoryIds: readonly string[]) => {
    const query = new URLSearchParams(detailsQuery);
    const categoryId = query.get("categoryId");
    if (
      categoryId != null &&
      categoryId !== UNCATEGORIZED_SENTINEL &&
      !validCategoryIds.includes(categoryId)
    ) {
      query.delete("categoryId");
    }
    navigate("details", query);
  };

  return (
    <SettingsTab
      ledger={ledger}
      initialCategories={categories}
      initialBooks={books}
      {...(userEmail !== undefined ? { userEmail } : {})}
      hasPassword={hasPassword}
      passwordUpdatedAt={passwordUpdatedAt}
      onGoToDetails={goToDetails}
    />
  );
}
