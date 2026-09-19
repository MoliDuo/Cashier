import { LedgerPageClient } from "@/modules/workspace/ui/LedgerPageClient";
import type { LedgerTab } from "@/lib/ledger-tabs";
import type { LedgerDto } from "@/modules/ledger/contracts";
import type { EntryCategoryWithCount } from "@/modules/ledger/contracts";
import type { InterfaceLanguage } from "@/modules/auth/contracts";
import type { BookDto } from "@/modules/ledger/contracts";

interface ActiveContentProps {
  ledgerId: string;
  userId: string;
  ledgerDto: LedgerDto;
  initialTab: LedgerTab;
  userEmail?: string;
  hasPassword?: boolean;
  passwordUpdatedAt?: string | null;
  interfaceLanguage?: InterfaceLanguage;
  initialCategories?: EntryCategoryWithCount[];
  ledgerToday?: string;
  initialBooks?: readonly BookDto[];
  /** The book this device's cookie resolved to, null for 总账. */
  initialBookId?: string | null;
  /**
   * The device zone the server read from this browser's cookie, null when it had
   * none. A page that cannot date itself waits for it rather than guessing.
   */
  initialDeviceTimeZone?: string | null;
}

export function ActiveContent({
  ledgerId,
  userId,
  ledgerDto,
  initialTab,
  userEmail,
  hasPassword,
  passwordUpdatedAt,
  interfaceLanguage,
  initialCategories,
  ledgerToday,
  initialBooks,
  initialBookId,
  initialDeviceTimeZone,
}: ActiveContentProps) {
  return (
    <LedgerPageClient
      ledgerId={ledgerId}
      userId={userId}
      initialLedger={ledgerDto}
      initialTab={initialTab}
      {...(initialCategories !== undefined ? { initialCategories } : {})}
      {...(ledgerToday !== undefined ? { ledgerToday } : {})}
      {...(initialBooks !== undefined ? { initialBooks } : {})}
      {...(initialBookId !== undefined ? { initialBookId } : {})}
      {...(initialDeviceTimeZone !== undefined ? { initialDeviceTimeZone } : {})}
      {...(userEmail !== undefined ? { userEmail } : {})}
      {...(hasPassword !== undefined ? { hasPassword } : {})}
      {...(passwordUpdatedAt !== undefined ? { passwordUpdatedAt } : {})}
      {...(interfaceLanguage !== undefined ? { interfaceLanguage } : {})}
    />
  );
}
