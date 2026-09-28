"use client";
import { SettingsTab } from "@/modules/ledger/ui/SettingsTab";
import { useLedgerWorkspace } from "../ledger-workspace-context";

interface SettingsRouteProps {
  userEmail?: string;
}

/** 设置. The account facts come from the page's own server render. */
export function SettingsRoute({ userEmail }: SettingsRouteProps) {
  const { ledger, categories, books } = useLedgerWorkspace();

  return (
    <SettingsTab
      ledger={ledger}
      initialCategories={categories}
      initialBooks={books}
      {...(userEmail !== undefined ? { userEmail } : {})}
    />
  );
}
