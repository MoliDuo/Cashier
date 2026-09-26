import { Suspense } from "react";
import { HydrationBoundary, type DehydratedState } from "@tanstack/react-query";
import { logger } from "@/lib/logger";
import { logIdentifier } from "@/lib/security/log-identifier";
import {
  getLedgerShellBootstrap,
  loadLedgerView,
  type LedgerView,
} from "@/modules/workspace/server/ledger-page-bootstrap";
import { WorkspaceStoreProvider } from "@/modules/workspace/store";
import { LedgerWorkspace } from "@/modules/workspace/ui/LedgerWorkspace";
import { scheduleProcessingRecoveryAfter } from "@/server/processing/recovery";
import { LedgerRouteFallback } from "./_route-fallback";
import { LedgerShell } from "./_shell";
import { orSignIn } from "./_sign-in";

/**
 * What the ledger's four routes share: the header and tab bar, the book being
 * viewed, the new-record dialog and the detail sheets. Moving between the
 * routes keeps all of it mounted; only the page below it changes.
 */
export default async function LedgerLayout({ children }: { children: React.ReactNode }) {
  const view = await orSignIn(loadLedgerView());
  // Authenticated request boundary for processing recovery: the reads stay
  // side-effect free, but every document load still gets a recovery pass
  // after the response finishes.
  scheduleProcessingRecoveryAfter(view.context.ledgerId);

  return (
    <WorkspaceStoreProvider initialBookId={view.bookId}>
      <LedgerShell>
        <Suspense fallback={<LedgerRouteFallback />}>
          <LedgerShellData view={view}>{children}</LedgerShellData>
        </Suspense>
      </LedgerShell>
    </WorkspaceStoreProvider>
  );
}

async function LedgerShellData({
  view,
  children,
}: {
  view: LedgerView;
  children: React.ReactNode;
}) {
  const { ledgerDto } = view.context;
  let state: DehydratedState | undefined;
  try {
    state = await getLedgerShellBootstrap({
      ledgerDto,
      books: view.books,
      categories: view.categories,
    });
  } catch (error) {
    logger.error(
      { error, ledgerSubject: logIdentifier("ledger", ledgerDto.id) },
      "Ledger shell bootstrap failed; falling back to client queries"
    );
  }

  return (
    <HydrationBoundary state={state}>
      <LedgerWorkspace
        initialDeviceTimeZone={view.deviceTimeZone}
        {...(view.ledgerToday !== undefined ? { ledgerToday: view.ledgerToday } : {})}
      >
        {children}
      </LedgerWorkspace>
    </HydrationBoundary>
  );
}
