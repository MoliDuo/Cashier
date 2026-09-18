/**
 * The pull-down book switch: thresholds and rules for the strip that hides
 * above 流水 / 明细 / 统计 until you pull the page down at the top.
 *
 * Kept out of the hook so both gestures — touch drag and mouse wheel — and the
 * component that paints them can be tested without a browser.
 */

/** How tall the strip is when it is fully open. */
export const PULL_REVEAL_HEIGHT = 56;
/** The finger travels twice as far as the strip grows, so a short pull is enough. */
export const PULL_REVEAL_DAMPING = 0.5;
/** 60% of the full height is where a release opens the strip instead of snapping back. */
export const PULL_REVEAL_OPEN_RATIO = 0.6;
/** A flick opens it even if the finger barely moved. */
export const PULL_REVEAL_FLICK_VELOCITY = 0.3;
/** Movement before the gesture counts as either a pull or a tab swipe. */
const PULL_REVEAL_SLOP = 8;
/** Upward wheel travel that opens the strip. */
export const WHEEL_REVEAL_THRESHOLD = 60;
/** Wheel deltas only accumulate while they keep arriving this fast. */
export const WHEEL_REVEAL_WINDOW_MS = 300;

const PULL_REVEAL_IGNORE_SELECTOR = [
  "input",
  "textarea",
  "select",
  "[role='dialog']",
  "[data-pull-reveal-ignore]",
].join(", ");

export type PullAxis = "pull" | "horizontal" | "none";

/**
 * Which gesture a drag has started. A sideways drag belongs to
 * `SwipeTabSurface`, so it is dropped here rather than fought over.
 */
export function resolvePullAxis(dx: number, dy: number): PullAxis {
  if (Math.abs(dx) > Math.abs(dy)) return "horizontal";
  if (dy <= PULL_REVEAL_SLOP) return "none";
  return "pull";
}

/** Raw finger travel to visible height, damped and clamped. */
export function applyPullDamping(distance: number): number {
  return Math.min(PULL_REVEAL_HEIGHT, Math.max(0, distance * PULL_REVEAL_DAMPING));
}

/** A pixel height as the strip's single grid row: `0fr` closed, `1fr` open. */
export function revealRows(height: number): string {
  const ratio = Math.min(1, Math.max(0, height / PULL_REVEAL_HEIGHT));
  return `${ratio}fr`;
}

/** Whether a released pull leaves the strip open. */
export function resolvePullRevealOpen(distance: number, velocity: number): boolean {
  const revealed = applyPullDamping(distance);
  if (revealed >= PULL_REVEAL_HEIGHT * PULL_REVEAL_OPEN_RATIO) return true;
  return revealed > 0 && velocity >= PULL_REVEAL_FLICK_VELOCITY;
}

/** Batch selection replaces the browsing controls, so a pull must not interrupt it. */
export function isBatchSelectionActive(): boolean {
  return document.documentElement.dataset.batchSelection === "true";
}

/**
 * A pull belongs to the page only when it starts on the page. Inputs, dialogs,
 * and the batch-selection band own their own gestures.
 */
export function shouldIgnorePullReveal(target: EventTarget | null): boolean {
  if (isBatchSelectionActive()) return true;
  if (!(target instanceof Element)) return true;
  return target.closest(PULL_REVEAL_IGNORE_SELECTOR) != null;
}

export interface WheelRevealAccumulator {
  /** Records one wheel event; returns true once the strip should open. */
  add(input: { deltaY: number; scrollY: number; time: number }): boolean;
  reset(): void;
}

/**
 * Upward wheel travel at the top of the page, summed over a short window: a
 * trackpad flick arrives as many small deltas, a mouse wheel as a few large
 * ones, and both have to reach the threshold without a pause in between.
 */
export function createWheelRevealAccumulator(): WheelRevealAccumulator {
  let total = 0;
  let lastTime: number | null = null;
  const reset = () => {
    total = 0;
    lastTime = null;
  };
  return {
    add({ deltaY, scrollY, time }) {
      if (scrollY > 0 || deltaY >= 0) {
        reset();
        return false;
      }
      if (lastTime != null && time - lastTime > WHEEL_REVEAL_WINDOW_MS) total = 0;
      lastTime = time;
      total += -deltaY;
      if (total < WHEEL_REVEAL_THRESHOLD) return false;
      reset();
      return true;
    },
    reset,
  };
}
