import "server-only";
import { cache } from "react";
import { auth } from "@/auth";
import { getLiveLedger } from "@/modules/ledger/server/live-ledger";
import { isValidUuid } from "@/lib/validation";
import { NotFoundError, UnauthorizedError } from "@/lib/errors";
import type { LedgerDto } from "@/modules/ledger/contracts";

export interface AuthenticatedHomeContext {
  userId: string;
  ledgerId: string;
  ledgerDto: LedgerDto;
  session: {
    user?: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      hasPassword: boolean;
      passwordUpdatedAt: string | null;
    };
  };
}

/**
 * Request-scoped cached helper that resolves auth, home ledger, and
 * ledger access in a single pass. Returns the consolidated context
 * so callers never need to call auth(), getLiveLedger(), or
 * requireLedgerAccess() separately within the same render tree.
 */
export const resolveAuthenticatedHome = cache(async (): Promise<AuthenticatedHomeContext> => {
  const session = await auth();
  const userId = session?.user?.id;
  if (userId == null || userId === "") {
    throw new UnauthorizedError();
  }

  const validSession = session!;

  const ledger = await getLiveLedger(userId);
  if (ledger == null) throw new UnauthorizedError("Shared ledger is unavailable");

  if (!isValidUuid(ledger.id)) {
    throw new NotFoundError("Ledger");
  }

  return {
    userId,
    ledgerId: ledger.id,
    ledgerDto: ledger,
    session: {
      user: {
        id: userId,
        email: validSession.user?.email ?? null,
        hasPassword: validSession.user?.hasPassword ?? false,
        passwordUpdatedAt: validSession.user?.passwordUpdatedAt ?? null,
      },
    },
  };
});
