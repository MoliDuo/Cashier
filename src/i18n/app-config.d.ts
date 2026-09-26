import type messages from "../../messages/zh.json";

/** Keys passed to `useTranslations` / `getTranslations` are checked against the catalog. */
declare module "next-intl" {
  interface AppConfig {
    Locale: "zh";
    Messages: typeof messages;
  }
}
