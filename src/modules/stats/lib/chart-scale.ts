/**
 * A y-axis that ends on a round number: steps of 1, 2, 2.5 or 5 times a power
 * of ten, so the ticks read 0 / 1,000 / 2,000 / 3,000 / 4,000 rather than
 * 0 / 1,011 / 2,022 / 3,033. Three to five steps are tried and the lowest top
 * that holds `max` wins, so ¥3,032 gets an axis to ¥4,000 and not to ¥6,000.
 */
export function niceScale(max: number): { max: number; ticks: number[] } {
  if (!Number.isFinite(max) || max <= 0) {
    return { max: 1, ticks: [0, 1 / 3, 2 / 3, 1] };
  }
  let best: { step: number; steps: number } | null = null;
  for (const steps of [3, 4, 5]) {
    const rough = max / steps;
    const magnitude = 10 ** Math.floor(Math.log10(rough));
    const step =
      [1, 2, 2.5, 5, 10]
        .map((factor) => factor * magnitude)
        .find((candidate) => candidate >= rough) ?? 10 * magnitude;
    if (best == null || step * steps < best.step * best.steps) best = { step, steps };
  }
  const { step, steps } = best!;
  return {
    max: step * steps,
    ticks: Array.from({ length: steps + 1 }, (_, index) => step * index),
  };
}
