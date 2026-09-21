import { Suspense } from "react";
import { getLocale, getMessages } from "next-intl/server";
import { cookies } from "next/headers";
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
import {
  getScopedLedgerSearchParams,
  readLedgerFilterParams,
  readStatsSearchParams,
} from "@/modules/workspace/ledger-url-params";
import { DEVICE_TIME_ZONE_COOKIE, parseDeviceTimeZoneCookie } from "@/lib/time-zone-cookie";
import { BOOK_SCOPE_COOKIE, parseBookScopeCookie } from "@/lib/book-scope-cookie";
import { ActiveContent } from "./_active-content";
import { ActiveShell } from "./_active-shell";
import { LedgerBootstrapFallback } from "./_ledger-bootstrap-fallback";
import { getLedgerPageBootstrap } from "@/modules/workspace/application/queries/get-ledger-page-bootstrap";
import { scheduleProcessingRecoveryAfter } from "@/application/processing/schedule-processing-recovery";
import { serverComposition } from "@/application/server-composition-root";
import type { LedgerDto } from "@/modules/ledger/contracts";
import type { LedgerTab } from "@/lib/ledger-tabs";

type PageBootstrapResult = Awaited<ReturnType<typeof getLedgerPageBootstrap>>;

interface ActiveTabBootstrapProps {
  pageDataPromise: Promise<PageBootstrapResult>;
  ledgerId: string;
  ledgerDto: LedgerDto;
  activeTab: LedgerTab;
  session: AuthenticatedHomeContext["session"];
  /**
   * The book this device's cookie names, validated as a UUID but not yet
   * against the live list. It is the fallback scope for a bootstrap that answers
   * nothing: losing it would quietly reset the reader to 总账.
   */
  rememberedBookId: string | null;
  /**
   * The device zone the server read from this browser's cookie, validated but
   * possibly absent. It survives a failed bootstrap so the page still dates by
   * the device the first time it renders.
   */
  initialDeviceTimeZone: string | null;
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
  // The viewed book is this device's remembered choice, not a URL parameter:
  // the cookie lets the server resolve the right scope on the first request,
  // so the prefetch already fills the view the reader left off at. 总账 is the
  // cookie being absent, `all`, or naming a book that is no longer live — the
  // bootstrap checks it against the live books.
  const cookieStore = await cookies();
  const bookScopeCookie = parseBookScopeCookie(cookieStore.get(BOOK_SCOPE_COOKIE)?.value ?? null);
  // The device zone the browser reported, written by the client after its first
  // render. It only breaks ties for a book without a zone of its own; an API
  // upload has no device and keeps the server zone.
  const deviceTimeZone = parseDeviceTimeZoneCookie(
    cookieStore.get(DEVICE_TIME_ZONE_COOKIE)?.value ?? null
  );
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
      ...(bookScopeCookie == null ? {} : { bookId: bookScopeCookie }),
      ...(deviceTimeZone == null ? {} : { deviceTimeZone }),
    },
    {
      categories: serverComposition.categories,
      books: serverComposition.books,
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

  return (
    <NextIntlClientProvider messages={await messagesPromise} locale={locale}>
      <ActiveShell ledgerId={ledgerId}>
        <Suspense fallback={<LedgerBootstrapFallback activeTab={activeTab} />}>
          <ActiveTabBootstrap
            pageDataPromise={pageDataPromise}
            ledgerId={ledgerId}
            ledgerDto={ledgerDto}
            activeTab={activeTab}
            session={session}
            rememberedBookId={bookScopeCookie}
            initialDeviceTimeZone={deviceTimeZone}
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
  rememberedBookId,
  initialDeviceTimeZone,
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
        initialTab={activeTab}
        {...(pageData?.initialCategories !== undefined
          ? { initialCategories: pageData.initialCategories }
          : {})}
        {...(pageData?.ledgerToday !== undefined ? { ledgerToday: pageData.ledgerToday } : {})}
        {...(pageData?.initialBooks !== undefined ? { initialBooks: pageData.initialBooks } : {})}
        initialBookId={pageData != null ? pageData.initialBookId : rememberedBookId}
        initialDeviceTimeZone={initialDeviceTimeZone}
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
