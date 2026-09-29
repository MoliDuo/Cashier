"use client";
import Image from "next/image";
import type { ChangeEvent, ClipboardEvent, ReactNode, RefObject } from "react";
import { ImagePlus, RefreshCw, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateFilter } from "@/components/ui/date-filter";
import { Textarea } from "@/components/ui/textarea";
import { textRoleClassName } from "@/components/typography";
import { cn } from "@/lib/utils";
import { useFileDropZone } from "../hooks/useFileDropZone";
import type { CameraCapture } from "../hooks/useCameraCapture";
import { SourceDocumentCameraPanel } from "./SourceDocumentCameraPanel";
import { NewRecordFooter } from "./NewRecordFooter";
import {
  SourceDocumentImageModal,
  type SourceDocumentModalImage,
} from "./SourceDocumentImageModal";
import type { SourceDocumentSubmissionProgress } from "../hooks/source-document-submission-upload";
import { commonCopy } from "@/copy/common";
import { sourceDocumentInputCopy } from "@/copy/source-document";

const imageActionButtonClassName =
  "absolute right-0 top-0 z-10 flex h-7 w-7 -translate-y-1/4 translate-x-1/4 items-center justify-center rounded-full text-white transition-opacity after:absolute after:h-11 after:w-11 after:content-[''] opacity-100 focus-visible:opacity-100 [@media(any-hover:hover)]:opacity-0 [@media(any-hover:hover)]:group-hover:opacity-100";

export interface SourceDocumentInputViewProps {
  mode: "create" | "retry";
  text: string;
  entryDate: Date;
  images: SourceDocumentModalImage[];
  selectedImageIndex: number | null;
  fileInputRef: RefObject<HTMLInputElement | null>;
  isPending: boolean;
  isSubmitting: boolean;
  isPreparingImages?: boolean;
  progress: SourceDocumentSubmissionProgress | null;
  canSubmit: boolean;
  canCancelUpload: boolean;
  /** False on a desktop pointer, or when the retry dialog reuses this form. */
  isCameraAvailable: boolean;
  isCameraOpen: boolean;
  remainingImageSlots: number;
  camera: CameraCapture;
  isDropEnabled: boolean;
  onEntryDateChange: (date: Date) => void;
  onTextChange: (value: string) => void;
  onTextareaPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onFileInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onSelectImages: () => void;
  onAddImageFiles: (files: File[]) => void;
  onCameraOpen: () => void;
  onCameraCollapse: () => void;
  onSubmit: () => void;
  onCancelUpload: () => void;
  onRemoveImage: (index: number) => void;
  onImageOpen: (index: number) => void;
  onImageClose: () => void;
  /** Shown at the start of the footer, beside the submit — the book picker. */
  footerStart?: ReactNode;
  /** Shown at the end of the date row — the new-record sheet's close control. */
  dateEnd?: ReactNode;
}

export function SourceDocumentInputView({
  mode,
  text,
  entryDate,
  images,
  selectedImageIndex,
  fileInputRef,
  isPending,
  isSubmitting,
  isPreparingImages = false,
  progress,
  canSubmit,
  canCancelUpload,
  isCameraAvailable,
  isCameraOpen,
  remainingImageSlots,
  camera,
  isDropEnabled,
  onEntryDateChange,
  onTextChange,
  onTextareaPaste,
  onFileInputChange,
  onSelectImages,
  onAddImageFiles,
  onCameraOpen,
  onCameraCollapse,
  onSubmit,
  onCancelUpload,
  onRemoveImage,
  onImageOpen,
  onImageClose,
  footerStart,
  dateEnd,
}: SourceDocumentInputViewProps) {
  const drop = useFileDropZone({ enabled: isDropEnabled, onFiles: onAddImageFiles });
  const showsViewfinder =
    isCameraAvailable &&
    isCameraOpen &&
    camera.status !== "unavailable" &&
    camera.status !== "unsupported" &&
    camera.status !== "insecure";
  // Closed, the camera is one button beside 图片; open, or unable to open, it
  // takes a full-width row of its own under them.
  const cameraInRow =
    isCameraAvailable &&
    !isCameraOpen &&
    camera.status !== "insecure" &&
    camera.status !== "unsupported";
  const cameraPanel = isCameraAvailable ? (
    <SourceDocumentCameraPanel
      videoRef={camera.videoRef}
      status={camera.status}
      canSwitch={camera.canSwitch}
      isMirrored={camera.isMirrored}
      isOpen={isCameraOpen}
      isBusy={isSubmitting}
      remaining={remainingImageSlots}
      onCapture={camera.capture}
      onSwitchFacing={camera.switchFacing}
      onOpen={onCameraOpen}
      onCollapse={onCameraCollapse}
      onRetry={camera.retry}
    />
  ) : null;

  return (
    <div
      className={cn("flex flex-col gap-3", drop.isDragging && "rounded-md ring-1 ring-primary")}
      {...drop.dropProps}
    >
      {drop.isDragging ? (
        <p role="status" className={textRoleClassName("meta")}>
          {sourceDocumentInputCopy.dropImages}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <DateFilter
          value={entryDate}
          onChange={(date) => onEntryDateChange(date ?? new Date())}
          placeholder={sourceDocumentInputCopy.entryDate}
          size="sm"
          className="min-w-0 flex-1"
          disabled={isPending}
        />
        {dateEnd}
      </div>

      <div className={cn("grid gap-2", cameraInRow && "grid-cols-2")}>
        {cameraInRow ? cameraPanel : null}
        <input
          type="file"
          ref={fileInputRef}
          onChange={onFileInputChange}
          accept="image/jpeg,image/png,image/gif,image/webp"
          multiple
          aria-label={sourceDocumentInputCopy.image}
          className="hidden"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cameraInRow ? undefined : "justify-self-start"}
          onClick={onSelectImages}
          disabled={isPending}
        >
          <ImagePlus className="h-4 w-4" />
          {sourceDocumentInputCopy.image}
        </Button>
      </div>

      {cameraInRow ? null : cameraPanel}

      {images.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {images.map((image, index) => {
            const imageLabel = sourceDocumentInputCopy.uploadedImage({ index: index + 1 });
            return (
              <div key={`${image.data}-${index}`} className="group relative">
                <button
                  type="button"
                  className="relative aspect-square w-full cursor-pointer overflow-hidden rounded-md border border-border transition-opacity hover:opacity-90"
                  onClick={() => onImageOpen(index)}
                  aria-label={imageLabel}
                >
                  <Image src={image.data} alt={imageLabel} fill className="object-cover" />
                </button>

                <button
                  onClick={() => onRemoveImage(index)}
                  type="button"
                  aria-label={commonCopy.delete}
                  title={commonCopy.delete}
                  className={`${imageActionButtonClassName} bg-danger`}
                  disabled={isPending}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <Textarea
        value={text}
        onChange={(event) => onTextChange(event.target.value)}
        onPaste={onTextareaPaste}
        placeholder={sourceDocumentInputCopy.placeholder}
        aria-label={sourceDocumentInputCopy.inputLabel}
        className="resize-none"
        rows={4}
        autoFocus={!showsViewfinder}
        disabled={isPending}
      />

      {progress != null ? (
        <SubmissionProgress
          progress={progress}
          canCancel={canCancelUpload}
          onCancel={onCancelUpload}
        />
      ) : isPreparingImages ? (
        <div className={textRoleClassName("bodyMuted", "flex items-center gap-2")} role="status">
          <RefreshCw className="h-4 w-4 animate-spin" />
          {sourceDocumentInputCopy.preparing}
        </div>
      ) : null}

      <NewRecordFooter start={footerStart}>
        <Button
          type="button"
          onClick={onSubmit}
          disabled={isPending || !canSubmit}
          className="min-w-28"
        >
          {isSubmitting ? (
            commonCopy.sendingStatus
          ) : mode === "retry" ? (
            <>
              <RefreshCw className="mr-2 h-4 w-4" />
              {commonCopy.retry}
            </>
          ) : (
            <>
              <Send className="mr-2 h-4 w-4" />
              {sourceDocumentInputCopy.send}
            </>
          )}
        </Button>
      </NewRecordFooter>

      <SourceDocumentImageModal
        images={images}
        initialIndex={selectedImageIndex ?? 0}
        open={selectedImageIndex !== null}
        onOpenChange={(open) => {
          if (!open) {
            onImageClose();
          }
        }}
      />
    </div>
  );
}

function SubmissionProgress({
  progress,
  canCancel,
  onCancel,
}: {
  progress: SourceDocumentSubmissionProgress;
  canCancel: boolean;
  onCancel: () => void;
}) {
  const percent = progress.percent;
  const isIndeterminate = progress.phase === "submitting";
  const phaseLabel =
    progress.phase === "preparing" || progress.phase === "planning"
      ? sourceDocumentInputCopy.preparing
      : progress.phase === "uploading"
        ? sourceDocumentInputCopy.uploading
        : progress.phase === "finalizing"
          ? sourceDocumentInputCopy.finalizing
          : progress.phase === "cancelling"
            ? sourceDocumentInputCopy.cancelling
            : sourceDocumentInputCopy.submitting;

  return (
    <div className="space-y-2" role="status" aria-live="polite">
      <div className={textRoleClassName("bodyMuted", "flex items-center justify-between")}>
        <span>{phaseLabel}</span>
        <div className="flex items-center gap-2">
          {isIndeterminate ? null : <span className="tabular-nums">{percent}%</span>}
          {canCancel ? (
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
              {sourceDocumentInputCopy.cancelUpload}
            </Button>
          ) : null}
        </div>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-surface2"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        {...(isIndeterminate ? {} : { "aria-valuenow": percent })}
        aria-label={phaseLabel}
      >
        <div
          className={
            isIndeterminate
              ? "h-full w-1/3 animate-pulse rounded-full bg-primary"
              : "h-full bg-primary transition-[width] duration-200"
          }
          {...(isIndeterminate ? {} : { style: { width: `${percent}%` } })}
        />
      </div>
    </div>
  );
}
