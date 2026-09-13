"use client";
import Image from "next/image";
import type { ChangeEvent, ClipboardEvent, RefObject } from "react";
import { Camera, RefreshCw, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateFilter } from "@/components/ui/date-filter";
import { Textarea } from "@/components/ui/textarea";
import { textRoleClassName } from "@/components/typography";
import { cn } from "@/lib/utils";
import { useFileDropZone } from "../hooks/useFileDropZone";
import type { CameraCapture } from "../hooks/useCameraCapture";
import {
  SourceDocumentCameraPanel,
  type SourceDocumentCameraPanelMessages,
} from "./SourceDocumentCameraPanel";
import {
  SourceDocumentImageModal,
  type SourceDocumentModalImage,
} from "./SourceDocumentImageModal";
import type { SourceDocumentSubmissionProgress } from "../hooks/source-document-submission-upload";

const imageActionButtonClassName =
  "absolute right-0 top-0 z-10 flex h-7 w-7 -translate-y-1/4 translate-x-1/4 items-center justify-center rounded-full text-white transition-opacity after:absolute after:h-11 after:w-11 after:content-[''] opacity-100 focus-visible:opacity-100 [@media(any-hover:hover)]:opacity-0 [@media(any-hover:hover)]:group-hover:opacity-100";

interface SourceDocumentInputViewMessages {
  placeholder: string;
  image: string;
  send: string;
  retry: string;
  delete: string;
  sendingStatus: string;
  entryDate: string;
  preparing: string;
  uploading: string;
  finalizing: string;
  submitting: string;
  cancelling: string;
  cancelUpload: string;
  uploadedImage: (index: number) => string;
  camera: SourceDocumentCameraPanelMessages;
  dropImages: string;
}

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
  messages: SourceDocumentInputViewMessages;
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
  messages,
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
}: SourceDocumentInputViewProps) {
  const drop = useFileDropZone({ enabled: isDropEnabled, onFiles: onAddImageFiles });
  const showsViewfinder =
    isCameraAvailable &&
    isCameraOpen &&
    camera.status !== "unavailable" &&
    camera.status !== "unsupported";

  return (
    <div
      className={cn("space-y-4", drop.isDragging && "rounded-md ring-1 ring-primary")}
      {...drop.dropProps}
    >
      {drop.isDragging ? (
        <p role="status" className={textRoleClassName("meta")}>
          {messages.dropImages}
        </p>
      ) : null}

      <DateFilter
        value={entryDate}
        onChange={(date) => onEntryDateChange(date ?? new Date())}
        placeholder={messages.entryDate}
        size="sm"
        className="w-full"
        disabled={isPending}
      />

      {isCameraAvailable ? (
        <SourceDocumentCameraPanel
          videoRef={camera.videoRef}
          status={camera.status}
          canSwitch={camera.canSwitch}
          isMirrored={camera.isMirrored}
          isOpen={isCameraOpen}
          isBusy={isSubmitting}
          remaining={remainingImageSlots}
          messages={messages.camera}
          onCapture={camera.capture}
          onSwitchFacing={camera.switchFacing}
          onOpen={onCameraOpen}
          onCollapse={onCameraCollapse}
          onRetry={camera.retry}
        />
      ) : null}

      {images.length > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {images.map((image, index) => {
            const imageLabel = messages.uploadedImage(index + 1);
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
                  aria-label={messages.delete}
                  title={messages.delete}
                  className={`${imageActionButtonClassName} bg-danger text-xs`}
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
        placeholder={messages.placeholder}
        aria-label={messages.placeholder}
        className="resize-none"
        rows={5}
        autoFocus={!showsViewfinder}
        disabled={isPending}
      />

      {progress != null ? (
        <SubmissionProgress
          progress={progress}
          messages={messages}
          canCancel={canCancelUpload}
          onCancel={onCancelUpload}
        />
      ) : isPreparingImages ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <RefreshCw className="h-4 w-4 animate-spin" />
          {messages.preparing}
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <input
          type="file"
          ref={fileInputRef}
          onChange={onFileInputChange}
          accept="image/jpeg,image/png,image/gif,image/webp"
          multiple
          aria-label={messages.image}
          className="hidden"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onSelectImages}
          disabled={isPending}
        >
          <Camera className="mr-2 h-4 w-4" />
          {messages.image}
        </Button>
        <div className="flex-1" />
        <Button
          type="button"
          onClick={onSubmit}
          disabled={isPending || !canSubmit}
          className="flex-1 sm:flex-initial"
        >
          {isSubmitting ? (
            messages.sendingStatus
          ) : mode === "retry" ? (
            <>
              <RefreshCw className="mr-2 h-4 w-4" />
              {messages.retry}
            </>
          ) : (
            <>
              <Send className="mr-2 h-4 w-4" />
              {messages.send}
            </>
          )}
        </Button>
      </div>

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
  messages,
  canCancel,
  onCancel,
}: {
  progress: SourceDocumentSubmissionProgress;
  messages: SourceDocumentInputViewMessages;
  canCancel: boolean;
  onCancel: () => void;
}) {
  const percent = progress.percent;
  const isIndeterminate = progress.phase === "submitting";
  const phaseLabel =
    progress.phase === "preparing" || progress.phase === "planning"
      ? messages.preparing
      : progress.phase === "uploading"
        ? messages.uploading
        : progress.phase === "finalizing"
          ? messages.finalizing
          : progress.phase === "cancelling"
            ? messages.cancelling
            : messages.submitting;

  return (
    <div className="space-y-2" role="status" aria-live="polite">
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{phaseLabel}</span>
        <div className="flex items-center gap-2">
          {isIndeterminate ? null : <span className="tabular-nums">{percent}%</span>}
          {canCancel ? (
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
              {messages.cancelUpload}
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
