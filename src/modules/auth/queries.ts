import { postLedgerQuery } from "@/lib/queries/post-ledger-query";
import type { PasskeySummary } from "./contracts";

/** The account's sign-in methods for 设置, served by `/api/ledger-queries`. */
export const fetchLoginEmails = () => postLedgerQuery<string[]>("login-emails");

export const fetchPasskeys = () => postLedgerQuery<PasskeySummary[]>("passkeys");
