import { requireLedgerAccess } from "@/modules/ledger/access";

type SourceDocumentLedgerAccess = Awaited<ReturnType<typeof requireLedgerAccess>>;

export interface SourceDocumentLedgerActionContext extends SourceDocumentLedgerAccess {
  ledgerId: string;
}

export function withSourceDocumentLedgerAccess<TArgs extends unknown[], TReturn>(
  action: (context: SourceDocumentLedgerActionContext, ...args: TArgs) => Promise<TReturn>
): (...args: TArgs) => Promise<TReturn> {
  return async (...args: TArgs) => {
    const access = await requireLedgerAccess();

    return action({ ledgerId: access.ledger.id, ...access }, ...args);
  };
}
