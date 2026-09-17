import { Suspense } from "react";
import { getLocale, getMessages } from "next-intl/server";
import { NextIntlClientProvider } from "next-intl";
import { HydrationBoundary } from "@tanstack/react-query";
import { redirect } from "@/i18n/routing";
import {
  resolveAuthenticatedHome,
  type AuthenticatedHomeContext,
} from "@/modules/workspace/server/resolve-authenticated-home";
import { UnauthorizedError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { logIdentifier } from "@/lib/security/log-identifier";
import { parsePeriodFromSearchParams } from "@/lib/period-utils";
import { parseLedgerTab } from "@/lib/ledger-tabs";
import { pickMessages, FEATURE_MESSAGES } from "@/i18n/client-feature-messages";
import {
  getScopedLedgerSearchParams,
  readLedgerFilterParams,
  readStatsSearchParams,
} from "@/modules/workspace/ledger-url-params";
import { ActiveContent } from "./_active-content";
import { ActiveShell } from "./_active-shell";
import { LedgerBootstrapFallback } from "./_ledger-bootstrap-fallback";
import { getLedgerPageBootstrap } from "@/modules/workspace/application/queries/get-ledger-page-bootstrap";
import { scheduleProcessingRecoveryAfter } from "@/application/processing/schedule-processing-recovery";
import { serverComposition } from "@/application/server-composition-root";
import type { LedgerDto } from "@/modules/ledger/contracts";
import type { LedgerTab } from "@/lib/ledger-tabs";
import { getCoupleConfig } from "@/lib/couple-config";

type PageBootstrapResult = Awaited<ReturnType<typeof getLedgerPageBootstrap>>;

interface ActiveTabBootstrapProps {
  pageDataPromise: Promise<PageBootstrapResult>;
  ledgerId: string;
  ledgerDto: LedgerDto;
  activeTab: LedgerTab;
  session: AuthenticatedHomeContext["session"];
}

interface ActiveTabProps {
  searchParams: Record<string, string | string[] | undefined>;
}

export async function ActiveTab({ searchParams }: ActiveTabProps) {
  const localePromise = getLocale();
  const contextPromise = resolveAuthenticatedHome();
  const locale = await localePromise;
  const messagesPromise = getMessages({ locale });
  let context;
  try {
    context = await contextPromise;
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      redirect({ href: "/login", locale });
      return null;
    }
    throw error;
  }

  const { ledgerId, ledgerDto, session } = context;

  const activeTab = parseLedgerTab(searchParams);
  const filterScope = activeTab === "details" ? "details" : "stream";
  const urlSearchParams = toUrlSearchParams(searchParams);
  const periodParams = parsePeriodFromSearchParams(
    getScopedLedgerSearchParams(urlSearchParams, filterScope)
  );
  const advancedFilters = readLedgerFilterParams(urlSearchParams, filterScope);
  const statsState = readStatsSearchParams(urlSearchParams);
  const pageDataPromise = getLedgerPageBootstrap(
    {
      ledgerId,
      initialTab: activeTab,
      periodParams,
      advancedFilters,
      statsState,
      ledgerDto,
    },
    {
      categories: serverComposition.categories,
      ledgerReads: serverComposition.ledgerReads,
      stats: serverComposition.stats,
      sourceDocuments: {
        documents: serverComposition.sourceDocumentReads,
        ledgerReads: serverComposition.ledgerReads,
        changes: serverComposition.ledgerChanges,
      },
      credentials: serverComposition.serviceCredentials,
    }
  );
  // Authenticated request boundary for processing recovery: the bootstrap
  // query stays side-effect free, but every visit to this route still gets
  // a recovery pass after the response finishes.
  scheduleProcessingRecoveryAfter(ledgerId);

  const allMessages = await messagesPromise;
  const activeFeature =
    activeTab === "details"
      ? "details"
      : activeTab === "stats"
        ? "stats"
        : activeTab === "settings"
          ? "settings"
          : "stream";
  const activeMessages = pickMessages(allMessages, [
    ...FEATURE_MESSAGES.shell,
    ...FEATURE_MESSAGES[activeFeature],
  ]);

  return (
    <NextIntlClientProvider messages={activeMessages} locale={locale}>
      <ActiveShell ledgerId={ledgerId}>
        <Suspense fallback={<LedgerBootstrapFallback activeTab={activeTab} />}>
          <ActiveTabBootstrap
            pageDataPromise={pageDataPromise}
            ledgerId={ledgerId}
            ledgerDto={ledgerDto}
            activeTab={activeTab}
            session={session}
          />
        </Suspense>
      </ActiveShell>
    </NextIntlClientProvider>
  );
}

async function ActiveTabBootstrap({
  pageDataPromise,
  ledgerId,
  ledgerDto,
  activeTab,
  session,
}: ActiveTabBootstrapProps) {
  let pageData: PageBootstrapResult;
  try {
    pageData = await pageDataPromise;
  } catch (error) {
    logger.error(
      { error, ledgerSubject: logIdentifier("ledger", ledgerId) },
      "Ledger page bootstrap failed; falling back to client queries"
    );
    pageData = null;
  }

  return (
    <HydrationBoundary state={pageData?.dehydratedState}>
      <ActiveContent
        ledgerId={ledgerId}
        ledgerDto={ledgerDto}
        userId={session.user!.id}
        partnerUserId={
          session.user!.id === getCoupleConfig()?.ownerId
            ? getCoupleConfig()!.partnerId
            : getCoupleConfig()!.ownerId
        }
        initialTab={activeTab}
        {...(pageData?.initialCategories !== undefined
          ? { initialCategories: pageData.initialCategories }
          : {})}
        {...(pageData?.ledgerToday !== undefined ? { ledgerToday: pageData.ledgerToday } : {})}
        {...(session.user?.email != null ? { userEmail: session.user.email } : {})}
        hasPassword={session.user?.hasPassword ?? false}
        passwordUpdatedAt={session.user?.passwordUpdatedAt ?? null}
        interfaceLanguage={session.user?.interfaceLanguage ?? "auto"}
      />
    </HydrationBoundary>
  );
}

function toUrlSearchParams(searchParams: Record<string, string | string[] | undefined>) {
  const result = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) value.forEach((item) => result.append(key, item));
    else if (value != null) result.set(key, value);
  }
  return result;
}
