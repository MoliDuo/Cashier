import { describe, expect, it } from "vitest";
import {
  PULL_REVEAL_HEIGHT,
  applyPullDamping,
  createWheelRevealAccumulator,
  isBatchSelectionActive,
  resolvePullAxis,
  resolvePullRevealOpen,
  revealRows,
  shouldIgnorePullReveal,
} from "@/modules/workspace/pull-reveal";

describe("pull reveal", () => {
  it("damps finger travel by half and clamps at the strip's height", () => {
    expect(applyPullDamping(0)).toBe(0);
    expect(applyPullDamping(40)).toBe(20);
    expect(applyPullDamping(-30)).toBe(0);
    expect(applyPullDamping(1000)).toBe(PULL_REVEAL_HEIGHT);
  });

  it("locks the axis: a sideways drag belongs to the tab swipe", () => {
    expect(resolvePullAxis(30, 4)).toBe("horizontal");
    expect(resolvePullAxis(-24, 3)).toBe("horizontal");
    expect(resolvePullAxis(2, 4)).toBe("none");
    expect(resolvePullAxis(1, 40)).toBe("pull");
    expect(resolvePullAxis(-1, -40)).toBe("none");
  });

  it("opens past 60% of the height, or on a flick that was fast enough", () => {
    // 0.6 * 56 = 33.6px of strip, which is 67.2px of finger.
    expect(resolvePullRevealOpen(68, 0)).toBe(true);
    expect(resolvePullRevealOpen(60, 0)).toBe(false);
    expect(resolvePullRevealOpen(20, 0.4)).toBe(true);
    expect(resolvePullRevealOpen(20, 0.2)).toBe(false);
    // A flick with nothing revealed is not a pull.
    expect(resolvePullRevealOpen(0, 5)).toBe(false);
  });

  it("names the fraction of the strip a partial pull shows", () => {
    expect(revealRows(0)).toBe("0fr");
    expect(revealRows(PULL_REVEAL_HEIGHT / 2)).toBe("0.5fr");
    expect(revealRows(PULL_REVEAL_HEIGHT)).toBe("1fr");
    expect(revealRows(500)).toBe("1fr");
  });

  it("ignores inputs, dialogs, marked elements, and batch selection", () => {
    const input = document.createElement("input");
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const marked = document.createElement("div");
    marked.dataset.pullRevealIgnore = "";
    const chip = document.createElement("button");
    chip.dataset.pullRevealIgnore = "";
    const plain = document.createElement("div");

    expect(shouldIgnorePullReveal(input)).toBe(true);
    expect(shouldIgnorePullReveal(dialog)).toBe(true);
    expect(shouldIgnorePullReveal(marked)).toBe(true);
    expect(shouldIgnorePullReveal(chip)).toBe(true);
    expect(shouldIgnorePullReveal(plain)).toBe(false);
    expect(shouldIgnorePullReveal(null)).toBe(true);

    document.documentElement.dataset.batchSelection = "true";
    expect(isBatchSelectionActive()).toBe(true);
    expect(shouldIgnorePullReveal(plain)).toBe(true);
    delete document.documentElement.dataset.batchSelection;
    expect(shouldIgnorePullReveal(plain)).toBe(false);
  });

  it("sums upward wheel travel at the top, and only within the window", () => {
    const accumulator = createWheelRevealAccumulator();

    expect(accumulator.add({ deltaY: -30, scrollY: 0, time: 0 })).toBe(false);
    expect(accumulator.add({ deltaY: -30, scrollY: 0, time: 50 })).toBe(true);

    // A pause starts the count over rather than adding to the old total.
    expect(accumulator.add({ deltaY: -40, scrollY: 0, time: 100 })).toBe(false);
    expect(accumulator.add({ deltaY: -40, scrollY: 0, time: 500 })).toBe(false);

    // Away from the top, and scrolling down, are both ignored.
    expect(accumulator.add({ deltaY: -80, scrollY: 200, time: 600 })).toBe(false);
    expect(accumulator.add({ deltaY: 80, scrollY: 0, time: 610 })).toBe(false);

    accumulator.add({ deltaY: -30, scrollY: 0, time: 700 });
    expect(accumulator.add({ deltaY: -30, scrollY: 0, time: 710 })).toBe(true);
  });
});
