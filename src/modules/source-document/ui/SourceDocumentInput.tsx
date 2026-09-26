"use client";
import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { MAX_FILES } from "@/lib/storage/upload-policy";
import { DraftNotice } from "@/components/ui/draft-notice";
import { useSourceDocumentInputController } from "../hooks/useSourceDocumentInputController";
import type { SourceDocumentInputProps } from "./source-document-input.types";
import { SourceDocumentInputView } from "./SourceDocumentInputView";

export function SourceDocumentInput(props: SourceDocumentInputProps) {
  return <SourceDocumentInputSession key={props.sourceDocumentId ?? "create"} {...props} />;
}

function SourceDocumentInputSession(props: SourceDocumentInputProps) {
  const { onPendingChange, onDirtyChange } = props;
  const t = useTranslations("SourceDocumentInput");
  const tCommon = useTranslations("Common");
  const controller = useSourceDocumentInputController({
    ...props,
    messages: {
      retrySuccess: t("retrySuccess"),
      retryError: t("retryError"),
      imageTooLarge: (fileName: string) => t("imageTooLarge", { fileName }),
      imageUnsupported: (fileName: string) => t("imageUnsupported", { fileName }),
      imageReadError: t("imageReadError"),
      imageUploadError: t("imageUploadError"),
      networkError: t("networkError"),
      validationError: t("validationError"),
      createError: t("createError"),
      tooManyImages: t("tooManyImages", { count: MAX_FILES }),
    },
  });

  useEffect(() => {
    onPendingChange?.(controller.isSubmitting);
    return () => onPendingChange?.(false);
  }, [controller.isSubmitting, onPendingChange]);

  useEffect(() => {
    onDirtyChange?.(controller.isDirty);
    return () => onDirtyChange?.(false);
  }, [controller.isDirty, onDirtyChange]);

  return (
    <div className="space-y-3">
      {controller.restoredFromDraft ? (
        <DraftNotice disabled={controller.isPending} onDiscard={controller.discardDraft} />
      ) : null}
      <SourceDocumentInputView
        mode={controller.mode}
        text={controller.text}
        entryDate={controller.entryDate}
        images={controller.images}
        selectedImageIndex={controller.selectedImageIndex}
        fileInputRef={controller.fileInputRef}
        isPending={controller.isPending}
        isSubmitting={controller.isSubmitting}
        isPreparingImages={controller.isPreparingImages}
        progress={controller.progress}
        canSubmit={controller.canSubmit}
        isCameraAvailable={controller.mode === "create" && controller.isTouchInput}
        isCameraOpen={controller.isCameraOpen}
        remainingImageSlots={controller.remainingImageSlots}
        camera={controller.camera}
        isDropEnabled={!controller.isTouchInput}
        messages={{
          placeholder: t("placeholder"),
          image: t("image"),
          send: t("send"),
          retry: tCommon("retry"),
          delete: tCommon("delete"),
          sendingStatus: tCommon("sending_status"),
          entryDate: t("entryDate"),
          preparing: t("preparing"),
          uploading: t("uploading"),
          finalizing: t("finalizing"),
          submitting: t("submitting"),
          cancelling: t("cancelling"),
          cancelUpload: t("cancelUpload"),
          uploadedImage: (index: number) => t("uploadedImage", { index }),
          camera: {
            preview: t("cameraPreview"),
            starting: t("cameraStarting"),
            unavailable: t("cameraUnavailable"),
            unsupported: t("cameraUnsupported"),
            insecure: t("cameraInsecure"),
            capture: t("capturePhoto"),
            limitReached: t("tooManyImages", { count: MAX_FILES }),
            switchCamera: t("switchCamera"),
            collapse: t("collapseCamera"),
            open: t("openCamera"),
            retry: tCommon("retry"),
          },
          dropImages: t("dropImages"),
        }}
        onEntryDateChange={controller.setEntryDate}
        onTextChange={controller.setText}
        onTextareaPaste={controller.handleTextareaPaste}
        onFileInputChange={controller.handleFileInputChange}
        onSelectImages={controller.triggerFileDialog}
        onAddImageFiles={controller.addImageFiles}
        onCameraOpen={controller.openCamera}
        onCameraCollapse={controller.collapseCamera}
        onSubmit={controller.handleSubmit}
        canCancelUpload={controller.canCancelUpload}
        onCancelUpload={controller.cancelUpload}
        onRemoveImage={controller.removeImage}
        onImageOpen={controller.openImage}
        onImageClose={controller.closeImage}
      />
    </div>
  );
}
