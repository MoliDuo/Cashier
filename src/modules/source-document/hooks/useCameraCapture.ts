"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Longest edge of a captured frame. The upload pipeline downscales to 1080 anyway. */
const MAX_CAPTURE_EDGE = 1600;
const CAPTURE_QUALITY = 0.92;

export type CameraStatus = "idle" | "starting" | "ready" | "unavailable" | "unsupported";

type FacingMode = "environment" | "user";

interface UseCameraCaptureOptions {
  /** False stops the stream: the form is hidden, collapsed, or submitting. */
  enabled: boolean;
  onCapture: (file: File) => void;
}

export interface CameraCapture {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  /** `unsupported` means no camera API at all — the caller should show nothing. */
  status: CameraStatus;
  /** True once the device reports more than one camera, so switching means something. */
  canSwitch: boolean;
  isMirrored: boolean;
  capture: () => void;
  switchFacing: () => void;
  retry: () => void;
}

export function useCameraCapture({ enabled, onCapture }: UseCameraCaptureOptions): CameraCapture {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const generationRef = useRef(0);
  const [status, setStatus] = useState<CameraStatus>("idle");
  const [canSwitch, setCanSwitch] = useState(false);
  const [facing, setFacing] = useState<FacingMode>("environment");
  const [retryToken, setRetryToken] = useState(0);
  const [isDocumentVisible, setIsDocumentVisible] = useState(true);

  useEffect(() => {
    const update = () => setIsDocumentVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  const stopStream = useCallback(() => {
    generationRef.current += 1;
    const stream = streamRef.current;
    streamRef.current = null;
    stream?.getTracks().forEach((track) => track.stop());
    if (videoRef.current != null) videoRef.current.srcObject = null;
  }, []);

  const shouldRun = enabled && isDocumentVisible;

  useEffect(() => {
    if (!shouldRun) return;
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const isCurrent = () => generationRef.current === generation;

    const start = async () => {
      if (navigator.mediaDevices?.getUserMedia == null) {
        setStatus("unsupported");
        return;
      }
      setStatus("starting");

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: facing },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        });
      } catch {
        if (!isCurrent()) return;
        // Denied permission, no camera, or a camera another app is holding.
        setStatus("unavailable");
        return;
      }

      if (!isCurrent()) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;
      const video = videoRef.current;
      if (video != null) {
        video.srcObject = stream;
        await video.play().catch(() => {});
      }
      if (!isCurrent()) return;
      setStatus("ready");

      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (isCurrent()) {
          setCanSwitch(devices.filter((device) => device.kind === "videoinput").length > 1);
        }
      } catch {
        if (isCurrent()) setCanSwitch(false);
      }
    };

    void start();
    return stopStream;
  }, [shouldRun, facing, retryToken, stopStream]);

  const capture = useCallback(() => {
    const video = videoRef.current;
    if (video == null || video.videoWidth === 0 || video.videoHeight === 0) return;

    const scale = Math.min(1, MAX_CAPTURE_EDGE / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.round(video.videoWidth * scale);
    const height = Math.round(video.videoHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (context == null) return;
    context.drawImage(video, 0, 0, width, height);

    canvas.toBlob(
      (blob) => {
        if (blob == null) return;
        onCapture(new File([blob], `capture-${Date.now()}.jpg`, { type: "image/jpeg" }));
      },
      "image/jpeg",
      CAPTURE_QUALITY
    );
  }, [onCapture]);

  const switchFacing = useCallback(() => {
    setFacing((current) => (current === "environment" ? "user" : "environment"));
  }, []);

  const retry = useCallback(() => setRetryToken((token) => token + 1), []);

  return {
    videoRef,
    status,
    canSwitch,
    isMirrored: facing === "user",
    capture,
    switchFacing,
    retry,
  };
}
