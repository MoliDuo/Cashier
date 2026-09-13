"use client";

import { useRef, useState } from "react";
import type { DragEvent } from "react";

interface UseFileDropZoneOptions {
  enabled: boolean;
  onFiles: (files: File[]) => void;
}

function carriesFiles(event: DragEvent<HTMLDivElement>): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
}

/**
 * Turns a container into a drop target for files.
 *
 * `dragenter` and `dragleave` also fire for every child the pointer crosses, so
 * a depth counter keeps the highlight from flickering as it moves through them.
 * A drag that carries no files — selected text, say — is left to the browser.
 */
export function useFileDropZone({ enabled, onFiles }: UseFileDropZoneOptions) {
  const depthRef = useRef(0);
  const [isDragging, setIsDragging] = useState(false);

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!enabled || !carriesFiles(event)) return;
    depthRef.current += 1;
    setIsDragging(true);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!enabled || !carriesFiles(event)) return;
    // Without this the browser refuses the drop and never fires `drop`.
    event.preventDefault();
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!enabled || !carriesFiles(event)) return;
    depthRef.current = Math.max(0, depthRef.current - 1);
    if (depthRef.current === 0) setIsDragging(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    depthRef.current = 0;
    setIsDragging(false);
    if (!carriesFiles(event)) return;
    event.preventDefault();
    if (!enabled) return;
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) onFiles(files);
  };

  return {
    isDragging,
    dropProps: {
      onDragEnter: handleDragEnter,
      onDragOver: handleDragOver,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
    },
  };
}
