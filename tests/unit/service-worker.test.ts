import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The worker's whole job is a decision a reader cannot see until it bites: a
 * new version never takes over a page on its own. These tests run the worker's
 * real message handler against a stand-in global scope and read back the
 * options it hands Serwist.
 */

const { serwistWorkerOptions, addEventListeners } = vi.hoisted(() => ({
  serwistWorkerOptions: { current: null as Record<string, unknown> | null },
  addEventListeners: vi.fn(),
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
