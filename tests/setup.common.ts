import { afterEach, vi } from "vitest";
import React from "react";
import type * as ReactModule from "react";
import { installTestEnvironment } from "../scripts/test-environment";
import "./setup.network";

installTestEnvironment();

/**
 * Promises of fire-and-forget `after()` callbacks registered during tests.
 * Tests await them via `flushAfterCallbacks()` before destructive setup (for
 * example the per-test TRUNCATE) so request-bound work cannot deadlock with
 * the next test's table locks.
 */
const { afterCallbacks } = await vi.hoisted(async () => ({
  afterCallbacks: (await import("./helpers/after-callbacks")).createAfterCallbackTracker(),
}));

/**
 * Drain pending `after()` callbacks within a bounded budget, including
 * callbacks registered by earlier callbacks (the recovery pass schedules
 * job execution). A timeout fails the test and retains unfinished work so
 * the next destructive setup cannot mistake it for a drained queue.
 */
export async function flushAfterCallbacks(timeoutMs = 2500): Promise<void> {
  await afterCallbacks.flush(timeoutMs);
}

afterEach(() => flushAfterCallbacks());

// Server code reads the session through getCurrentSession, which needs a
// request's cookies; tests stand in a signed-in session and override it per
// test with vi.mocked(getCurrentSession).
vi.mock("@/modules/auth/server/current-session", async () => {
  const { testSession } = await import("./helpers/session");
  return {
    getCurrentSession: vi.fn(async () => testSession()),
    startSession: vi.fn(async () => {}),
    endSession: vi.fn(async () => {}),
  };
});

vi.mock("next-intl", async () => {
  const actual = await vi.importActual("react");
  const React = actual as typeof ReactModule;
  const defaultMessages = await import("../messages/zh.json").then((m) => m.default ?? m);

  const defaultMessagesRecord = defaultMessages as Record<string, unknown>;
  interface IntlContextValue {
    messages: Record<string, unknown>;
    locale: string;
  }
  const IntlContext = React.createContext<IntlContextValue | null>(null);

  const valueAtPath = (value: unknown, path: string): unknown =>
    path.split(".").reduce<unknown>((current, segment) => {
      if (current == null || typeof current !== "object" || !(segment in current)) return undefined;
      return (current as Record<string, unknown>)[segment];
    }, value);

  return {
    useTranslations: (namespace?: string) => {
      const context = React.useContext(IntlContext);
      const messages = context?.messages ?? defaultMessagesRecord;
      const fullKey = (key: string) => (namespace == null ? key : `${namespace}.${key}`);
      const translate = (key: string, values?: Record<string, unknown>) => {
        const msg = valueAtPath(messages, fullKey(key));
        if (msg == null) return fullKey(key);
        let translated = msg as string;
        if (values != null && typeof translated === "string") {
          Object.keys(values).forEach((k) => {
            translated = translated.replaceAll(`{${k}}`, String(values[k]));
          });
        }
        return translated;
      };
      translate.raw = (key: string) => valueAtPath(messages, fullKey(key));
      return translate;
    },
    useLocale: () => React.useContext(IntlContext)?.locale ?? "zh",
    useMessages: () => React.useContext(IntlContext)?.messages ?? defaultMessagesRecord,
    useTimeZone: () => "UTC",
    useNow: () => new Date(),
    NextIntlClientProvider: ({
      children,
      messages,
      locale,
    }: {
      children: React.ReactNode;
      messages: Record<string, unknown>;
      locale: string;
    }) => React.createElement(IntlContext.Provider, { value: { messages, locale } }, children),
  };
});

vi.mock("next/image", () => ({
  __esModule: true,
  default: (props: { src: string; alt: string; [key: string]: unknown }) => {
    return React.createElement("img", { ...props, src: props.src });
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}));

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: afterCallbacks.register,
  };
});
