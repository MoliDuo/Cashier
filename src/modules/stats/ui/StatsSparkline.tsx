"use client";
import { useMemo } from "react";
import { buildSparklineGeometry } from "@/modules/stats/lib/sparkline-path";
import { ChevronRight } from "lucide-react";
import { statsTabCopy } from "@/copy/stats";

interface StatsSparklineProps {
  current: { date: string; total: string }[];
  previous: { date: string; total: string }[];
  onExpand?: () => void;
  disabled?: boolean;
}

/**
 * The period's daily shape, always on screen under the total.
 *
 * The full trend chart is one of two views behind a switch, and a chart nobody
 * remembers to ask for is a chart nobody reads. Forty pixels of line costs
 * almost nothing and answers "was this a steady month or one bad Tuesday"
 * without a click; the click is still there for the detail.
 */
export function StatsSparkline({
  current,
  previous,
  onExpand,
  disabled = false,
}: StatsSparklineProps) {
  const geometry = useMemo(
    () =>
      buildSparklineGeometry({
        current: current.map((point) => Number(point.total)),
        previous: previous.map((point) => Number(point.total)),
      }),
    [current, previous]
  );

  if (geometry.current === "") return null;

  const figure = (
    <svg
      role="img"
      aria-label={statsTabCopy.sparklineLabel}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="h-10 w-full"
    >
      <path d={geometry.area} className="fill-primary/10" />
      {geometry.previous === "" ? null : (
        <polyline
          points={geometry.previous}
          fill="none"
          stroke="var(--chart-5)"
          strokeWidth="1.5"
          strokeDasharray="3 3"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          opacity="0.6"
        />
      )}
      <polyline
        points={geometry.current}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        className="text-primary"
      />
    </svg>
  );

  // The line itself is a picture, not a control; the way to the full chart is
  // a button that says where it goes.
  return (
    <div className="min-w-0 space-y-1 py-2">
      {figure}
      {onExpand == null || disabled ? null : (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onExpand}
            className="inline-flex items-center gap-0.5 rounded-md px-1 text-xs font-medium text-primary transition-colors hover:text-primary/80"
          >
            {statsTabCopy.sparklineExpand}
            <ChevronRight aria-hidden="true" className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
