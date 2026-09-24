import "server-only";
import { cache } from "react";
import { auth } from "@/auth";
import { resolveHome } from "@/modules/workspace/application/use-cases/resolve-home";
import { serverComposition } from "@/application/server-composition-root";
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
 * so callers never need to call auth(), resolveHome(), or
 * requireLedgerAccess() separately within the same render tree.
 */
export const resolveAuthenticatedHome = cache(async (): Promise<AuthenticatedHomeContext> => {
  const session = await auth();
  const userId = session?.user?.id;
  if (userId == null || userId === "") {
    throw new UnauthorizedError();
  }

  const validSession = session!;

  const ledger = await resolveHome(userId, serverComposition.ledgers);

  if (!isValidUuid(ledger.id)) {
    throw new NotFoundError("Ledger");
  }

  const ledgerDto: LedgerDto = {
    id: ledger.id,
    settings: ledger.settings,
    createdAt: ledger.createdAt,
    updatedAt: ledger.updatedAt,
  };

  return {
    userId,
    ledgerId: ledger.id,
    ledgerDto,
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
