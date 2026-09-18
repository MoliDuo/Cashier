"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import {
  PULL_REVEAL_HEIGHT,
  applyPullDamping,
  createWheelRevealAccumulator,
  resolvePullAxis,
  resolvePullRevealOpen,
  shouldIgnorePullReveal,
} from "../pull-reveal";

/** Long enough to see the pressed state on the option you just picked. */
const CLOSE_AFTER_PICK_MS = 150;
/** How long a finger-driven height stays before the strip takes over again. */
const SETTLE_MS = 180;
/** The strip and the chip that reopens it: their own taps must not close it. */
const OWN_GESTURE_SELECTOR = "[data-pull-reveal], [data-pull-reveal-ignore]";

interface UsePullRevealOptions {
  /** Only the tabs that carry the switch answer the gesture. */
  enabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export interface PullRevealController {
  /** Height the strip currently occupies, in pixels: 0 when closed. */
  height: number;
  /** True while a finger is driving the strip, so the paint is not animated. */
  dragging: boolean;
  openStrip: () => void;
  closeStrip: () => void;
  /** Closes after the press is visible; used when an option is picked. */
  closeAfterPick: () => void;
}

/**
 * Drives the hidden book switch. Touch and pen pull the page down at the top;
 * a mouse wheel scrolls up there. The strip is painted by the caller from
 * `height`, so the same numbers decide both the gesture and what is shown.
 */
export function usePullReveal({
  enabled,
  open,
  onOpenChange,
}: UsePullRevealOptions): PullRevealController {
  const reducedMotion = useReducedMotion();
  const [pull, setPull] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; time: number } | null>(null);
  const pulling = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openRef = useRef(open);
  // The listeners below are installed once and read the current state through
  // this ref, so a gesture never closes over a stale `open`.
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const clearCloseTimer = useCallback(() => {
    if (closeTimer.current != null) globalThis.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);

  const openStrip = useCallback(() => {
    clearCloseTimer();
    onOpenChange(true);
  }, [clearCloseTimer, onOpenChange]);

  const closeStrip = useCallback(() => {
    clearCloseTimer();
    start.current = null;
    pulling.current = false;
    setPull(0);
    setDragging(false);
    onOpenChange(false);
  }, [clearCloseTimer, onOpenChange]);

  const closeAfterPick = useCallback(() => {
    clearCloseTimer();
    closeTimer.current = globalThis.setTimeout(
      () => {
        closeTimer.current = null;
        closeStrip();
      },
      reducedMotion ? 0 : CLOSE_AFTER_PICK_MS
    );
  }, [clearCloseTimer, closeStrip, reducedMotion]);

  // A released pull leaves its own height behind; once the finger is gone the
  // strip's open/closed state decides again.
  useEffect(() => {
    if (dragging || pull === 0) return;
    const timer = globalThis.setTimeout(() => setPull(0), reducedMotion ? 0 : SETTLE_MS);
    return () => globalThis.clearTimeout(timer);
  }, [dragging, pull, reducedMotion]);

  useEffect(() => {
    if (!enabled) return;

    const handleTouchStart = (event: TouchEvent) => {
      // The page has to be at its top, otherwise the pull is a scroll.
      if (window.scrollY > 0 || openRef.current) return;
      if (shouldIgnorePullReveal(event.target)) return;
      const touch = event.touches[0];
      if (touch == null) return;
      start.current = { x: touch.clientX, y: touch.clientY, time: performance.now() };
      pulling.current = false;
    };

    const handleTouchMove = (event: TouchEvent) => {
      const origin = start.current;
      if (origin == null) return;
      const touch = event.touches[0];
      if (touch == null) return;
      const dx = touch.clientX - origin.x;
      const dy = touch.clientY - origin.y;
      const axis = resolvePullAxis(dx, dy);
      if (axis === "horizontal") {
        // A sideways drag belongs to the tab swipe; it is dropped, not fought
        // over.
        start.current = null;
        pulling.current = false;
        setDragging(false);
        setPull(0);
        return;
      }
      if (axis === "none") return;
      // Held still while the strip grows, the way a pull-down refresh behaves;
      // the browser would otherwise overscroll or refresh the page.
      if (event.cancelable) event.preventDefault();
      pulling.current = true;
      setDragging(true);
      setPull(applyPullDamping(dy));
    };

    const finish = (event: TouchEvent) => {
      const origin = start.current;
      start.current = null;
      const wasPulling = pulling.current;
      pulling.current = false;
      if (origin == null || !wasPulling) return;
      const touch = event.changedTouches[0];
      const dy = touch == null ? 0 : touch.clientY - origin.y;
      const velocity = dy / Math.max(1, performance.now() - origin.time);
      setDragging(false);
      if (resolvePullRevealOpen(dy, velocity)) openStrip();
      else setPull(0);
    };

    const accumulator = createWheelRevealAccumulator();
    const handleWheel = (event: WheelEvent) => {
      if (openRef.current) {
        // Scrolling down is what puts the switch away again.
        if (event.deltaY >= 0) closeStrip();
        return;
      }
      if (
        accumulator.add({
          deltaY: event.deltaY,
          scrollY: window.scrollY,
          time: performance.now(),
        })
      ) {
        openStrip();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && openRef.current) closeStrip();
    };

    // A tap anywhere else on the page puts the strip away, the way a popover
    // closes. Captured, so it runs before whatever the tap was meant to do.
    const handlePointerDown = (event: Event) => {
      if (!openRef.current) return;
      const target = event.target;
      if (target instanceof Element && target.closest(OWN_GESTURE_SELECTOR) != null) return;
      closeStrip();
    };

    document.addEventListener("touchstart", handleTouchStart, { passive: true });
    document.addEventListener("touchmove", handleTouchMove, { passive: false });
    document.addEventListener("touchend", finish, { passive: true });
    document.addEventListener("touchcancel", finish, { passive: true });
    window.addEventListener("wheel", handleWheel, { passive: true });
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("touchstart", handleTouchStart);
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchend", finish);
      document.removeEventListener("touchcancel", finish);
      window.removeEventListener("wheel", handleWheel);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [enabled, closeStrip, openStrip]);

  useEffect(() => clearCloseTimer, [clearCloseTimer]);

  return {
    height: open ? PULL_REVEAL_HEIGHT : pull,
    dragging,
    openStrip,
    closeStrip,
    closeAfterPick,
  };
}
