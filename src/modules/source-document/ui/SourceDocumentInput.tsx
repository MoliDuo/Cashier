"use client";
import { DraftNotice } from "@/components/ui/draft-notice";
import { useSourceDocumentInput } from "../hooks/useSourceDocumentInput";
import type { SourceDocumentInputProps } from "./source-document-input.types";
import { SourceDocumentInputView } from "./SourceDocumentInputView";

export function SourceDocumentInput(props: SourceDocumentInputProps) {
  return <SourceDocumentInputSession key={props.sourceDocumentId ?? "create"} {...props} />;
}

function SourceDocumentInputSession(props: SourceDocumentInputProps) {
  const input = useSourceDocumentInput(props);

  return (
    <div className="space-y-3">
      {input.restoredFromDraft ? (
        <DraftNotice disabled={input.isPending} onDiscard={input.discardDraft} />
      ) : null}
      <SourceDocumentInputView
        mode={input.mode}
        text={input.text}
        entryDate={input.entryDate}
        images={input.images}
        selectedImageIndex={input.selectedImageIndex}
        fileInputRef={input.fileInputRef}
        isPending={input.isPending}
        isSubmitting={input.isSubmitting}
        isPreparingImages={input.isPreparingImages}
        progress={input.progress}
        canSubmit={input.canSubmit}
        isCameraAvailable={input.mode === "create" && input.isTouchInput}
        isCameraOpen={input.isCameraOpen}
        remainingImageSlots={input.remainingImageSlots}
        camera={input.camera}
        isDropEnabled={!input.isTouchInput}
        onEntryDateChange={input.setEntryDate}
        onTextChange={input.setText}
        onTextareaPaste={input.handleTextareaPaste}
        onFileInputChange={input.handleFileInputChange}
        onSelectImages={input.triggerFileDialog}
        onAddImageFiles={input.addImageFiles}
        onCameraOpen={input.openCamera}
        onCameraCollapse={input.collapseCamera}
        onSubmit={input.handleSubmit}
        canCancelUpload={input.canCancelUpload}
        onCancelUpload={input.cancelUpload}
        onRemoveImage={input.removeImage}
        onImageOpen={input.openImage}
        onImageClose={input.closeImage}
      />
    </div>
  );
}
