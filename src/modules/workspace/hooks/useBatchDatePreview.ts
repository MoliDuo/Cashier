"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * What the batch date dialog shows about the change it is about to make:
 * nothing yet, the preview being worked out, a failed preview, or its result.
 */
export type BatchDatePreviewState<T> =
  | { status: "closed" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; impact: T };

/**
 * The preview both views show before a batch date move. The list is frozen
 * while selecting, so the selection a preview describes is the one the confirm
 * writes; every start or close takes a new request number, so an answer that
 * arrives after the dialog closed or asked again is dropped.
 */
export function useBatchDatePreview<T>(preview: () => Promise<T>) {
  const [state, setState] = useState<BatchDatePreviewState<T>>({ status: "closed" });
  const requestIdRef = useRef(0);
  const previewRef = useRef(preview);
  useEffect(() => {
    previewRef.current = preview;
  }, [preview]);

  const start = useCallback(() => {
    const requestId = ++requestIdRef.current;
    setState({ status: "loading" });
    void (async () => {
      try {
        const impact = await previewRef.current();
        if (requestIdRef.current === requestId) setState({ status: "ready", impact });
      } catch {
        if (requestIdRef.current === requestId) setState({ status: "error" });
      }
    })();
  }, []);

  const close = useCallback(() => {
    requestIdRef.current += 1;
    setState({ status: "closed" });
  }, []);

  // A request still in flight when the screen goes away has nowhere to land.
  useEffect(() => {
    return () => {
      requestIdRef.current += 1;
    };
  }, []);

  return {
    start,
    close,
    impact: state.status === "ready" ? state.impact : null,
    isPreviewing: state.status === "loading",
    failed: state.status === "error",
  };
}
