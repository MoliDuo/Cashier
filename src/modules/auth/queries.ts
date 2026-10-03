import { postLedgerQuery } from "@/lib/queries/post-ledger-query";

/** The addresses allowed to sign in, for 设置, served by `/api/ledger-queries`. */
export const fetchLoginEmails = () => postLedgerQuery<string[]>("login-emails");
