import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import { ServiceCredentialSection } from "@/modules/ledger/ui/ServiceCredentialSection";
import { FEATURE_MESSAGES, pickMessages } from "@/i18n/client-feature-messages";
import enMessages from "../../../../../messages/en.json";
import zhMessages from "../../../../../messages/zh.json";

/**
 * The standalone settings page bundles exactly the Shell and Settings
 * manifests, so `Common` (which supplies the Me/Partner vocabulary) has to
 * resolve from that picked subset for the ownership line to render.
 */
const settingsMessages = (messages: Record<string, unknown>) =>
  pickMessages(messages, [...FEATURE_MESSAGES.shell, ...FEATURE_MESSAGES.settings]);

const credentials = [
  {
    id: "mine",
    attributedUserId: "user-1",
    ledgerId: "ledger-1",
    name: "My script",
    tokenPrefix: "sk_live_a",
    tokenSuffix: "0001",
    createdAt: "2026-08-07T00:00:00.000Z",
    lastUsedAt: null,
    deletedAt: null,
  },
  {
    id: "theirs",
    attributedUserId: "user-2",
    ledgerId: "ledger-1",
    name: "Partner script",
    tokenPrefix: "sk_live_b",
    tokenSuffix: "0002",
    createdAt: "2026-08-06T00:00:00.000Z",
    lastUsedAt: null,
    deletedAt: null,
  },
];

describe("credential ownership labels", () => {
  it.each([
    ["en", enMessages, ["Owner: Me", "Owner: Partner"]],
    ["zh", zhMessages, ["归属：我", "归属：对方"]],
  ] as const)(
    "renders the owner of every shared credential with the %s catalog",
    (locale, messages, expected) => {
      render(
        <NextIntlClientProvider
          locale={locale}
          messages={settingsMessages(messages as Record<string, unknown>)}
        >
          <ServiceCredentialSection
            credentials={credentials}
            userId="user-1"
            partnerUserId="user-2"
            onCreateCredential={vi.fn()}
            onDeleteCredential={vi.fn()}
          />
        </NextIntlClientProvider>
      );

      expect(screen.getByText("My script")).toBeInTheDocument();
      expect(screen.getByText("Partner script")).toBeInTheDocument();
      for (const label of expected) {
        expect(screen.getByText(label)).toBeInTheDocument();
      }
    }
  );
});
