import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider, useLocale, useMessages, useTranslations } from "next-intl";
import { describe, expect, it } from "vitest";

// The mock is exercised with a made-up catalog, so the probe drops the key typing.
const useLooseTranslations = useTranslations as unknown as (
  namespace: string
) => (key: string) => string;

function ContextProbe() {
  const tAccount = useLooseTranslations("Settings.Account");
  const tOther = useLooseTranslations("Other");
  const locale = useLocale();
  const messages = useMessages();

  return (
    <>
      <span>{tAccount("passwordSection")}</span>
      <span>{tAccount("shared")}</span>
      <span>{tOther("shared")}</span>
      <span>{locale}</span>
      <span>{Object.keys(messages).join(",")}</span>
    </>
  );
}

describe("next-intl test mock", () => {
  it("honors provider subsets, dotted namespaces, and missing-key boundaries", () => {
    render(
      <NextIntlClientProvider
        locale="zh"
        messages={{
          Settings: {
            Account: {
              passwordSection: "Password",
            },
          },
          // @ts-expect-error -- a namespace the real catalog lacks is what the mock must handle
          Other: {
            shared: "Other value",
          },
        }}
      >
        <ContextProbe />
      </NextIntlClientProvider>
    );

    expect(screen.getByText("Password")).toBeInTheDocument();
    expect(screen.getByText("Settings.Account.shared")).toBeInTheDocument();
    expect(screen.getByText("Other value")).toBeInTheDocument();
    expect(screen.getByText("zh")).toBeInTheDocument();
    expect(screen.getByText("Settings,Other")).toBeInTheDocument();
  });
});
