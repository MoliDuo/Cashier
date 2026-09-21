import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The PWA policy is two decisions that a reader cannot see until they bite:
 * navigations are never served from the cache, and a new worker never takes
 * over a page on its own. Both used to be guarded by grepping the sources for
 * words, which a comment could break and a real regression could slip past.
 * These tests capture the options the build really hands Serwist and run the
 * worker's own message handler instead.
 */

const { serwistWorkerOptions, addEventListeners } = vi.hoisted(() => ({
  serwistWorkerOptions: { current: null as Record<string, unknown> | null },
  addEventListeners: vi.fn(),
}));

// Both Next plugins pull the same native file watcher in, and a native addon
// loaded from two worker threads at once fails to register. The options are
// read from next.config's own export rather than from these stand-ins.
vi.mock("@serwist/next", () => ({
  default:
    () =>
    <T>(config: T) =>
      config,
}));
vi.mock("next-intl/plugin", () => ({
  default:
    () =>
    <T>(config: T) =>
      config,
}));

vi.mock("serwist", () => ({
  Serwist: class {
    constructor(options: Record<string, unknown>) {
      serwistWorkerOptions.current = options;
    }
    addEventListeners = addEventListeners;
  },
}));

const SCOPE = "https://cashier.example/";

interface WorkerHarness {
  messageHandler: (event: unknown) => void;
  skipWaiting: ReturnType<typeof vi.fn>;
  matchAll: ReturnType<typeof vi.fn>;
  listenerTypes: string[];
}

/** Loads the worker into a stand-in global scope and hands back its handlers. */
async function loadWorker(windowUrls: string[], scope = SCOPE): Promise<WorkerHarness> {
  const listeners = new Map<string, (event: unknown) => void>();
  const skipWaiting = vi.fn().mockResolvedValue(undefined);
  const matchAll = vi.fn().mockResolvedValue(windowUrls.map((url) => ({ url })));
  vi.stubGlobal("self", {
    __SW_MANIFEST: [{ url: "/_next/static/chunk.js", revision: null }],
    addEventListener: (type: string, handler: (event: unknown) => void) =>
      listeners.set(type, handler),
    clients: { matchAll },
    registration: { scope },
    skipWaiting,
  });
  vi.resetModules();
  await import("@/service-worker");
  const messageHandler = listeners.get("message");
  if (messageHandler == null) throw new Error("The worker registered no message handler");
  return { messageHandler, skipWaiting, matchAll, listenerTypes: [...listeners.keys()] };
}

/** Delivers one `message` event and settles whatever the worker kept alive. */
async function send(
  harness: WorkerHarness,
  type: string,
  port?: { postMessage: ReturnType<typeof vi.fn> }
): Promise<void> {
  const pending: Promise<unknown>[] = [];
  harness.messageHandler({
    data: { type },
    ports: port == null ? [] : [port],
    waitUntil: (promise: Promise<unknown>) => pending.push(promise),
  });
  await Promise.all(pending);
}

describe("service worker activation protocol", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    serwistWorkerOptions.current = null;
  });

  it("precaches the build manifest without claiming a page that is already open", async () => {
    const harness = await loadWorker([SCOPE]);

    // An installed worker that skipped waiting would swap the running app's
    // chunks underneath it; the reader is asked first instead.
    expect(serwistWorkerOptions.current).toMatchObject({
      precacheEntries: [{ url: "/_next/static/chunk.js", revision: null }],
      skipWaiting: false,
      clientsClaim: true,
    });
    expect(addEventListeners).toHaveBeenCalledOnce();
    // No runtime cache and no offline fallback: a navigation always reaches the
    // network, so a signed-out reader never sees another account's shell.
    expect(serwistWorkerOptions.current).not.toHaveProperty("runtimeCaching");
    expect(serwistWorkerOptions.current).not.toHaveProperty("fallbacks");
    expect(serwistWorkerOptions.current).not.toHaveProperty("navigationPreload");
    // Precaching is Serwist's own; the worker adds nothing but the protocol.
    expect(harness.listenerTypes).toEqual(["message"]);
  });

  it("answers the window count over the caller's port without activating", async () => {
    const harness = await loadWorker([SCOPE, `${SCOPE}stats`]);
    const port = { postMessage: vi.fn() };

    await send(harness, "GET_WINDOW_COUNT", port);

    expect(port.postMessage).toHaveBeenCalledWith(2);
    expect(harness.skipWaiting).not.toHaveBeenCalled();
    expect(harness.matchAll).toHaveBeenCalledWith({ type: "window", includeUncontrolled: true });
  });

  it("counts only the windows inside this registration's scope", async () => {
    // The worker ships at the origin root today, so nothing same-origin falls
    // outside its scope. The filter is what keeps that true if the app is ever
    // mounted under a path: a neighbour on the same origin must not make one
    // tab look like two, which would defer the update forever.
    const scoped = "https://cashier.example/books/";
    const harness = await loadWorker(
      [scoped, `${scoped}stats`, "https://cashier.example/other-app/page"],
      scoped
    );
    const port = { postMessage: vi.fn() };

    await send(harness, "GET_WINDOW_COUNT", port);

    expect(port.postMessage).toHaveBeenCalledWith(2);
  });

  it("activates by itself only when the reader has a single window open", async () => {
    const alone = await loadWorker([SCOPE]);
    await send(alone, "ACTIVATE_SINGLE_WINDOW");
    expect(alone.skipWaiting).toHaveBeenCalledOnce();

    const accompanied = await loadWorker([SCOPE, `${SCOPE}details`]);
    await send(accompanied, "ACTIVATE_SINGLE_WINDOW");
    // The other window would lose whatever it is holding, so it is left alone.
    expect(accompanied.skipWaiting).not.toHaveBeenCalled();
  });

  it("activates on an explicit request however many windows are open", async () => {
    const harness = await loadWorker([SCOPE, `${SCOPE}details`, `${SCOPE}stats`]);

    await send(harness, "ACTIVATE_NOW");

    expect(harness.skipWaiting).toHaveBeenCalledOnce();
  });

  it("ignores a message it does not own without waking the clients", async () => {
    const harness = await loadWorker([SCOPE]);
    const port = { postMessage: vi.fn() };

    await send(harness, "SKIP_WAITING", port);
    harness.messageHandler({ data: null, ports: [], waitUntil: () => undefined });

    expect(harness.matchAll).not.toHaveBeenCalled();
    expect(harness.skipWaiting).not.toHaveBeenCalled();
    expect(port.postMessage).not.toHaveBeenCalled();
  });
});

describe("build-time PWA configuration", () => {
  it("never serves a navigation from the cache and keeps API chunks unprecached", async () => {
    const { serwistOptions } = await import("../../../next.config");

    expect(serwistOptions).toMatchObject({
      swSrc: "src/service-worker.ts",
      swDest: "public/sw.js",
      swUrl: "/sw.js",
      // The app shell is per-account and per-locale, so a cached navigation
      // could hand a reader a shell that is not theirs.
      cacheOnNavigation: false,
      reloadOnOnline: false,
    });

    const isExcluded = (asset: string) =>
      serwistOptions.exclude.some((pattern) => pattern.test(asset));
    expect(isExcluded("static/chunks/app/api/v1/route.js")).toBe(true);
    expect(isExcluded("server/middleware-manifest.json")).toBe(true);
    expect(isExcluded("app-build-manifest.json")).toBe(true);
    // The protected route's own chunks are precached: they are immutable and
    // content-hashed, and they are what makes the tab bar usable at once.
    expect(isExcluded("static/chunks/app/[locale]/(protected)/page-a1b2c3.js")).toBe(false);
    expect(isExcluded("static/chunks/main-app-9f8e7d.js")).toBe(false);
  });
});
