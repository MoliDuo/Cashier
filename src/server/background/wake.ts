// The signal that tells the background worker there is new work in the queue. The queue itself is
// database rows, so a lost signal costs nothing: the worker also polls. The listeners live on
// `globalThis` because the worker is started from instrumentation while the code that wakes it runs in
// route bundles, and the two do not share module instances.

type Listener = () => void;

const LISTENERS_KEY = Symbol.for("cashier.background.wake");

function listeners(): Set<Listener> {
  const holder = globalThis as unknown as Record<symbol, Set<Listener> | undefined>;
  return (holder[LISTENERS_KEY] ??= new Set<Listener>());
}

/** Call after committing work the worker should pick up. A no-op when no worker is running. */
export function requestBackgroundWork(): void {
  for (const listener of [...listeners()]) listener();
}

/** Subscribes to wake-ups; returns the function that unsubscribes. */
export function onBackgroundWork(listener: Listener): () => void {
  listeners().add(listener);
  return () => {
    listeners().delete(listener);
  };
}
