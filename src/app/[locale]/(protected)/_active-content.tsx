import { LedgerPageClient } from "@/modules/workspace/ui/LedgerPageClient";
import type { LedgerTab } from "@/lib/ledger-tabs";
import type { LedgerDto } from "@/modules/ledger/contracts";
import type { EntryCategoryWithCount } from "@/modules/ledger/contracts";
import type { InterfaceLanguage } from "@/modules/auth/contracts";

interface ActiveContentProps {
  ledgerId: string;
  userId: string;
  partnerUserId: string;
  ledgerDto: LedgerDto;
  initialTab: LedgerTab;
  userEmail?: string;
  hasPassword?: boolean;
  passwordUpdatedAt?: string | null;
  interfaceLanguage?: InterfaceLanguage;
  initialCategories?: EntryCategoryWithCount[];
  ledgerToday?: string;
}

export function ActiveContent({
  ledgerId,
  userId,
  partnerUserId,
  ledgerDto,
  initialTab,
  userEmail,
  hasPassword,
  passwordUpdatedAt,
  interfaceLanguage,
  initialCategories,
  ledgerToday,
}: ActiveContentProps) {
  return (
    <LedgerPageClient
      ledgerId={ledgerId}
      userId={userId}
      partnerUserId={partnerUserId}
      initialLedger={ledgerDto}
      initialTab={initialTab}
      {...(initialCategories !== undefined ? { initialCategories } : {})}
      {...(ledgerToday !== undefined ? { ledgerToday } : {})}
      {...(userEmail !== undefined ? { userEmail } : {})}
      {...(hasPassword !== undefined ? { hasPassword } : {})}
      {...(passwordUpdatedAt !== undefined ? { passwordUpdatedAt } : {})}
      {...(interfaceLanguage !== undefined ? { interfaceLanguage } : {})}
    />
  );
}
