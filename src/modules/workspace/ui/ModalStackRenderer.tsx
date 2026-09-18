import { useState } from "react";
import { useModalStackStore } from "@/lib/store/modal-stack";
import { SourceDocumentDetailWrapper } from "@/modules/source-document/ui/SourceDocumentDetailWrapper";
import type { BookDto, EntryCategory } from "@/modules/ledger/contracts";
import { closeLedgerDetail } from "@/lib/navigation/ledger-detail-navigation";
import { ledgerDetailLeaveGuardKey } from "@/lib/navigation/ledger-detail-key";
import { useUnsavedChangesStore } from "@/lib/store/unsaved-changes";

export interface ModalStackRendererProps {
  /** The live books, so an open record can be moved between them. */
  books: readonly BookDto[];
  categories: EntryCategory[];
  mainCurrency: string;
  preferredCurrencies: string[];
  timeZone?: string;
}

export function ModalStackRenderer({
  books,
  categories,
  mainCurrency,
  preferredCurrencies,
  timeZone,
}: ModalStackRendererProps) {
  const stack = useModalStackStore((state) => state.stack);
  const item = stack.at(-1);
  const itemKey = item == null ? null : `${item.type}:${item.ledgerId}:${item.id}`;
  const [closingKey, setClosingKey] = useState<string | null>(null);

  if (item == null) return null;
  const open = closingKey !== itemKey;
  const startExit = () => {
    setClosingKey(itemKey);
  };
  const requestBack = () => {
    const guardKey = ledgerDetailLeaveGuardKey(item.type, item.ledgerId, item.id);
    const guards = useUnsavedChangesStore.getState();
    const guard =
      guards.getLeaveGuard("source-document-retry-navigation") ?? guards.getLeaveGuard(guardKey);
    if (guard == null) startExit();
    else guard.requestLeave(startExit);
  };
  const onExitComplete = () => {
    const current = useModalStackStore.getState().stack.at(-1);
    if (current == null || `${current.type}:${current.ledgerId}:${current.id}` !== itemKey) {
      setClosingKey(null);
      return;
    }
    closeLedgerDetail();
    if (stack.length === 1) {
      const trigger = item.returnFocus;
      window.requestAnimationFrame(() => {
        if (trigger?.isConnected === true) trigger.focus();
        else {
          document.querySelector<HTMLElement>("[data-ledger-focus-fallback]")?.focus();
        }
      });
    }
    setClosingKey(null);
  };

  return stack.map((stackItem, index) => {
    const key = `${stackItem.type}:${stackItem.ledgerId}:${stackItem.id}`;
    const isTop = index === stack.length - 1;
    const sharedProps = {
      books,
      id: stackItem.id,
      ledgerId: stackItem.ledgerId,
      open: isTop && open,
      onClose: isTop ? startExit : () => {},
      ...(isTop && closingKey === key ? { onExitComplete } : {}),
      ...(isTop && stack.length > 1 ? { onBack: requestBack } : {}),
      categories,
      mainCurrency,
      preferredCurrencies,
      ...(timeZone != null ? { timeZone } : {}),
    };

    return <SourceDocumentDetailWrapper key={key} {...sharedProps} />;
  });
}
