import { requireLedgerAccess } from "@/modules/ledger/access";

type SourceDocumentLedgerActionContext = Awaited<ReturnType<typeof requireLedgerAccess>>;

/** Run a source-document command that needs the signed-in account or the ledger's settings. */
export function withSourceDocumentLedgerAccess<TArgs extends unknown[], TReturn>(
  action: (context: SourceDocumentLedgerActionContext, ...args: TArgs) => Promise<TReturn>
): (...args: TArgs) => Promise<TReturn> {
  return async (...args: TArgs) => action(await requireLedgerAccess(), ...args);
}
