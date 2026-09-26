"use client";

import type { RefObject } from "react";
import { useTranslations } from "next-intl";
import { Camera, ChevronUp, RefreshCw, SwitchCamera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { textRoleClassName } from "@/components/typography";
import { MAX_FILES } from "@/lib/storage/upload-policy";
import { cn } from "@/lib/utils";
import type { CameraStatus } from "../hooks/useCameraCapture";

interface SourceDocumentCameraPanelProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  status: CameraStatus;
  canSwitch: boolean;
  isMirrored: boolean;
  isOpen: boolean;
  isBusy: boolean;
  remaining: number;
  onCapture: () => void;
  onSwitchFacing: () => void;
  onOpen: () => void;
  onCollapse: () => void;
  onRetry: () => void;
}

/**
 * The in-form viewfinder: a full-width live box, then one row of controls.
 *
 * A browser that cannot open the camera says so in one line rather than
 * disappearing: a phone that expected a viewfinder and finds nothing has no way
 * to tell a missing camera from a missing feature.
 */
export function SourceDocumentCameraPanel({
  videoRef,
  status,
  canSwitch,
  isMirrored,
  isOpen,
  isBusy,
  remaining,
  onCapture,
  onSwitchFacing,
  onOpen,
  onCollapse,
  onRetry,
}: SourceDocumentCameraPanelProps) {
  const t = useTranslations("SourceDocumentInput");
  const tCommon = useTranslations("Common");
  if (status === "insecure" || status === "unsupported") {
    return (
      <p role="status" className={textRoleClassName("meta")}>
        {status === "insecure" ? t("cameraInsecure") : t("cameraUnsupported")}
      </p>
    );
  }

  if (!isOpen) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={onOpen}>
        <Camera className="h-4 w-4" />
        {t("openCamera")}
      </Button>
    );
  }

  if (status === "unavailable") {
    return (
      <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className={textRoleClassName("meta", "min-w-0")}>{t("cameraUnavailable")}</span>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="h-4 w-4" />
          {tCommon("retry")}
        </Button>
      </div>
    );
  }

  const isReady = status === "ready";
  const isFull = remaining <= 0;

  return (
    <div role="group" aria-label={t("cameraPreview")} className="space-y-2">
      <div className="relative aspect-video w-full overflow-hidden rounded-md border border-border bg-surface2">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          aria-hidden="true"
          className={cn(
            "h-full w-full object-cover",
            isMirrored && "-scale-x-100",
            isReady ? undefined : "invisible"
          )}
        />
        {isReady ? null : (
          <div role="status" className="absolute inset-0 flex items-center justify-center">
            <RefreshCw aria-hidden="true" className="h-4 w-4 animate-spin text-muted-foreground" />
            <span className="sr-only">{t("cameraStarting")}</span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onCollapse}
          aria-label={t("collapseCamera")}
          title={t("collapseCamera")}
        >
          <ChevronUp className="h-4 w-4" />
          {t("collapseCamera")}
        </Button>
        {canSwitch ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onSwitchFacing}
            disabled={!isReady}
          >
            <SwitchCamera className="h-4 w-4" />
            {t("switchCamera")}
          </Button>
        ) : null}
        <span {...(isFull ? { title: t("tooManyImages", { count: MAX_FILES }) } : {})}>
          <Button
            type="button"
            size="sm"
            onClick={onCapture}
            disabled={!isReady || isFull || isBusy}
            aria-label={t("capturePhoto")}
          >
            <Camera className="h-4 w-4" />
            {t("capturePhoto")}
          </Button>
        </span>
      </div>
    </div>
  );
}
