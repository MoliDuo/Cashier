"use client";

import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import type { LedgerTab } from "@/lib/ledger-tabs";
import { LEDGER_TAB_ORDER, resolveSwipeDestination, shouldIgnoreTabSwipe } from "../tab-swipe";

interface SwipeTabSurfaceProps {
  activeTab: LedgerTab;
  onTabChange: (tab: LedgerTab) => void;
  onTabIntent: (tab: LedgerTab) => void;
  children: ReactNode;
}

export function SwipeTabSurface({
  activeTab,
  onTabChange,
  onTabIntent,
  children,
}: SwipeTabSurfaceProps) {
  const reducedMotion = useReducedMotion();
  const start = useRef<{ x: number; y: number; time: number; pointerId: number } | null>(null);
  const horizontal = useRef(false);
  const [offset, setOffset] = useState(0);
  const [settling, setSettling] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timerRef.current != null) globalThis.clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  useEffect(() => {
    start.current = null;
    horizontal.current = false;
    clearTimer();
    const frame = window.requestAnimationFrame(() => {
      setOffset(0);
      setSettling(false);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      clearTimer();
    };
  }, [activeTab]);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (
      event.pointerType === "mouse" ||
      shouldIgnoreTabSwipe(event.target) ||
      document.documentElement.dataset.batchSelection === "true"
    )
      return;
    start.current = {
      x: event.clientX,
      y: event.clientY,
      time: performance.now(),
      pointerId: event.pointerId,
    };
    horizontal.current = false;
    const index = LEDGER_TAB_ORDER.indexOf(activeTab);
    const neighbors = [LEDGER_TAB_ORDER[index - 1], LEDGER_TAB_ORDER[index + 1]].filter(
      Boolean
    ) as LedgerTab[];
    neighbors.forEach(onTabIntent);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const origin = start.current;
    if (origin == null || origin.pointerId !== event.pointerId) return;
    const dx = event.clientX - origin.x;
    const dy = event.clientY - origin.y;
    if (!horizontal.current) {
      if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) {
        start.current = null;
        return;
      }
      if (Math.abs(dx) < 8) return;
      horizontal.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    const index = LEDGER_TAB_ORDER.indexOf(activeTab);
    const atEdge = (index === 0 && dx > 0) || (index === LEDGER_TAB_ORDER.length - 1 && dx < 0);
    setOffset(atEdge ? dx * 0.28 : dx);
  };

  const finish = (event: PointerEvent<HTMLDivElement>) => {
    const origin = start.current;
    start.current = null;
    if (origin == null || !horizontal.current) return;
    horizontal.current = false;
    const dx = event.clientX - origin.x;
    const velocity = dx / Math.max(1, performance.now() - origin.time);
    const destination = resolveSwipeDestination(activeTab, dx, velocity);
    if (destination == null) {
      setSettling(true);
      setOffset(0);
      clearTimer();
      timerRef.current = globalThis.setTimeout(
        () => {
          timerRef.current = null;
          setSettling(false);
        },
        reducedMotion ? 0 : 180
      );
      return;
    }
    if (reducedMotion) {
      setOffset(0);
      onTabChange(destination);
      return;
    }
    setSettling(true);
    setOffset(dx < 0 ? -window.innerWidth : window.innerWidth);
    clearTimer();
    timerRef.current = globalThis.setTimeout(() => {
      timerRef.current = null;
      onTabChange(destination);
    }, 140);
  };

  return (
    <div
      className="w-full min-w-0 max-w-full overflow-x-clip touch-pan-y touch-pinch-zoom"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finish}
      onPointerCancel={() => {
        clearTimer();
        start.current = null;
        horizontal.current = false;
        setOffset(0);
      }}
      style={{
        transform: `translate3d(${offset}px,0,0)`,
        transition: settling && !reducedMotion ? "transform 180ms cubic-bezier(.2,0,0,1)" : "none",
      }}
    >
      {children}
    </div>
  );
}
