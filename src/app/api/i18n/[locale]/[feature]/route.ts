import { NextResponse } from "next/server";
import { FEATURE_MESSAGES } from "@/i18n/client-feature-messages";
import { FEATURE_MESSAGE_VERSION } from "@/i18n/feature-message-version";
import { importFeatureMessages } from "@/i18n/feature-message-imports";
import { SUPPORTED_LOCALES, type SupportedLocale } from "@/i18n/locales";

export async function GET(
  _request: Request,
  context: { params: Promise<{ locale: string; feature: string }> }
) {
  const { locale, feature } = await context.params;
  if (
    !SUPPORTED_LOCALES.includes(locale as SupportedLocale) ||
    !Object.hasOwn(FEATURE_MESSAGES, feature)
  ) {
    // A not-found carries no version, so nothing makes it safe to keep: let a
    // cache hold it and the client replays the failure instead of asking again.
    return NextResponse.json(
      { error: "Not found" },
      { status: 404, headers: { "Cache-Control": "no-store" } }
    );
  }
  const messages = await importFeatureMessages(
    locale as SupportedLocale,
    feature as keyof typeof FEATURE_MESSAGES
  );
  return NextResponse.json(messages, {
    headers: {
      // The version in the URL is what makes the catalog safe to cache forever
      // in production. In development the catalogs are regenerated in place, so
      // an immutable response pins the browser to a snapshot that the running
      // dev server may no longer serve — leaving components rendering raw key
      // paths until the cache is cleared.
      "Cache-Control":
        process.env.NODE_ENV === "development" ? "no-store" : "public, max-age=31536000, immutable",
      "X-Message-Version": FEATURE_MESSAGE_VERSION,
    },
  });
}
