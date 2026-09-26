import { afterEach, vi } from "vitest";
import React from "react";
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
