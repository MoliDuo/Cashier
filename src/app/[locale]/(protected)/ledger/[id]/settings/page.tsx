import { HydrationBoundary } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { SettingsPageClient } from "@/modules/ledger/ui/SettingsPageClient";
import { pickMessages, FEATURE_MESSAGES } from "@/i18n/client-feature-messages";
import { auth } from "@/auth";
import { getLedgerSettingsBootstrap } from "@/modules/workspace/application/queries/get-ledger-settings-bootstrap";
import { scheduleProcessingRecoveryAfter } from "@/application/processing/schedule-processing-recovery";
import { serverComposition } from "@/application/server-composition-root";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getPartnerUserId } from "@/lib/couple-config";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/routing";
import { textRoleClassName } from "@/components/typography";

interface SettingsPageProps {
  params: Promise<{ id: string }>;
}

function LedgerNotFound({ message, backLabel }: { message: string; backLabel: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="flex w-full max-w-md flex-col gap-6 rounded-lg border border-border bg-surface p-8 text-center shadow-sm">
        <h1 className={textRoleClassName("pageTitle")}>{message}</h1>
        <Button variant="outline" className="w-full" asChild>
          <Link href="/">{backLabel}</Link>
        </Button>
      </div>
    </div>
  );
}

export default async function SettingsPage({ params }: SettingsPageProps) {
  const { id: ledgerId } = await params;
  if (!z.string().uuid().safeParse(ledgerId).success) notFound();
  const [locale, session] = await Promise.all([getLocale(), auth()]);
  const userId = session?.user?.id;
  const shared = userId ? await serverComposition.ledgers.getSharedForMember(userId) : null;
  const ledger = shared?.id === ledgerId ? shared : null;

  if (!ledger) {
    const t = await getTranslations({ locale, namespace: "LedgerPage" });
    const tError = await getTranslations({ locale, namespace: "LedgerError" });
    return <LedgerNotFound message={t("notFound")} backLabel={tError("backToHome")} />;
  }

  scheduleProcessingRecoveryAfter(ledgerId);

  const pageData = await getLedgerSettingsBootstrap(
    {
      ledgerId,
      ledgerDto: ledger,
    },
    {
      categories: serverComposition.categories,
      credentials: serverComposition.serviceCredentials,
      profiles: serverComposition.userProfiles,
    }
  );
  if (pageData == null) {
    const t = await getTranslations({ locale, namespace: "LedgerPage" });
    const tError = await getTranslations({ locale, namespace: "LedgerError" });
    return <LedgerNotFound message={t("notFound")} backLabel={tError("backToHome")} />;
  }

  const allMessages = await getMessages({ locale });
  const settingsMessages = pickMessages(allMessages, [
    ...FEATURE_MESSAGES.shell,
    ...FEATURE_MESSAGES.settings,
  ]);

  return (
    <NextIntlClientProvider messages={settingsMessages} locale={locale}>
      <HydrationBoundary state={pageData.dehydratedState}>
        <SettingsPageClient
          ledger={ledger}
          initialCategories={pageData.initialCategories}
          ledgerId={ledgerId}
          initialMembers={pageData.initialMembers}
          {...(userId != null ? { userId, partnerUserId: getPartnerUserId(userId) } : {})}
          {...(session?.user?.email != null ? { userEmail: session.user.email } : {})}
          {...(session?.user != null ? { hasPassword: session.user.hasPassword } : {})}
          {...(session?.user != null ? { passwordUpdatedAt: session.user.passwordUpdatedAt } : {})}
          {...(session?.user != null ? { interfaceLanguage: session.user.interfaceLanguage } : {})}
        />
      </HydrationBoundary>
    </NextIntlClientProvider>
  );
}
