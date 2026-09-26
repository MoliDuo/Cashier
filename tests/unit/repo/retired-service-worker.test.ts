import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

/**
 * Browsers that installed the old precaching worker still check `/sw.js` for
 * updates. The replacement must take over without waiting for every tab to
 * close, remove what the old worker cached, and leave nothing registered.
 */
function loadRetiredWorker() {
  const listeners = new Map<string, (event: unknown) => void>();
  const skipWaiting = vi.fn();
  const unregister = vi.fn().mockResolvedValue(true);
  const deleteCache = vi.fn().mockResolvedValue(true);
  const self = {
    addEventListener: (type: string, listener: (event: unknown) => void) =>
      listeners.set(type, listener),
    skipWaiting,
    registration: { unregister },
  };
  const caches = {
    keys: vi.fn().mockResolvedValue(["serwist-precache-v2-https://cashier.example/", "other"]),
    delete: deleteCache,
  };
  new Function("self", "caches", readFileSync("public/sw.js", "utf8"))(self, caches);
  return { listeners, skipWaiting, unregister, deleteCache };
}

describe("retired service worker", () => {
  it("activates immediately, clears every cache, and unregisters itself", async () => {
    const worker = loadRetiredWorker();
    expect([...worker.listeners.keys()].sort()).toEqual(["activate", "install"]);

    worker.listeners.get("install")!({});
    expect(worker.skipWaiting).toHaveBeenCalledTimes(1);

    let activation: Promise<unknown> | undefined;
    worker.listeners.get("activate")!({
      waitUntil: (promise: Promise<unknown>) => (activation = promise),
    });
    await activation;
    expect(worker.deleteCache.mock.calls.map(([key]) => key)).toEqual([
      "serwist-precache-v2-https://cashier.example/",
      "other",
    ]);
    expect(worker.unregister).toHaveBeenCalledTimes(1);
  });
});
