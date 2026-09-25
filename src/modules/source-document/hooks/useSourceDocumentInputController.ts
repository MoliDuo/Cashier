"use client";
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, ClipboardEvent } from "react";
import { toast } from "sonner";
import { fireAndForget } from "@/lib/safe-async";
import type { SourceDocumentInputProps } from "../ui/source-document-input.types";
import { buildSubmitPayload } from "./source-document-input-controller.core";
import { loadSourceDocumentInputFiles } from "./source-document-input-images";
import type { SourceDocumentInputControllerMessages } from "./source-document-input-controller.types";
import { useSourceDocumentInputDraft } from "./useSourceDocumentInputDraft";
import { useSourceDocumentSubmitMutations } from "./useSourceDocumentSubmitMutations";
import { useCameraCapture } from "./useCameraCapture";
import { useIsTouchInput } from "@/hooks/use-is-touch-input";
import { MAX_FILES } from "@/lib/storage/upload-policy";

type UseSourceDocumentInputControllerOptions = SourceDocumentInputProps & {
  messages: SourceDocumentInputControllerMessages;
};

export function useSourceDocumentInputController(options: UseSourceDocumentInputControllerOptions) {
  const { onSuccess, initialData, messages, timeZone } = options;
  const [target] = useState(() =>
    options.mode === "retry"
      ? {
          mode: options.mode,
          sourceDocumentId: options.sourceDocumentId,
        }
      : { mode: "create" as const }
  );
  const mode = target.mode;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingFileReservationsRef = useRef(0);
  const mountedRef = useRef(true);
  const compressionAbortRef = useRef<AbortController | null>(null);
  const [pendingFileCount, setPendingFileCount] = useState(0);
  const imageCountRef = useRef(0);
  const draft = useSourceDocumentInputDraft({
    ...(initialData != null ? { initialData } : {}),
    ...(timeZone != null ? { timeZone } : {}),
  });
  const submitMutations = useSourceDocumentSubmitMutations({
    ...(options.bookId == null ? {} : { bookId: options.bookId }),
    ...target,
    messages,
    onSuccess: (result) => {
      draft.resetDraft();
      onSuccess?.(result);
    },
  });
  imageCountRef.current = draft.images.length;
  useEffect(() => {
    const compressionAbort = new AbortController();
    compressionAbortRef.current = compressionAbort;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      compressionAbort.abort();
      if (compressionAbortRef.current === compressionAbort) compressionAbortRef.current = null;
    };
  }, []);

  const appendFiles = async (files: File[]) => {
    const remainingCapacity = Math.max(
      0,
      MAX_FILES - imageCountRef.current - pendingFileReservationsRef.current
    );
    if (files.length > remainingCapacity) {
      toast.error(messages.tooManyImages);
    }
    if (remainingCapacity === 0) return;
    const reservedFiles = files.slice(0, remainingCapacity);
    pendingFileReservationsRef.current += reservedFiles.length;
    setPendingFileCount(pendingFileReservationsRef.current);
    let results: Awaited<ReturnType<typeof loadSourceDocumentInputFiles>>;
    try {
      results = await loadSourceDocumentInputFiles(
        reservedFiles,
        compressionAbortRef.current?.signal
      );
    } finally {
      pendingFileReservationsRef.current -= reservedFiles.length;
      if (mountedRef.current) setPendingFileCount(pendingFileReservationsRef.current);
    }

    if (!mountedRef.current) return;

    const loadedImages = results.flatMap((result) => {
      if (result.kind === "too-large") {
        toast.error(messages.imageTooLarge(result.fileName));
        return [];
      }
      if (result.kind === "unsupported") {
        toast.error(messages.imageUnsupported(result.fileName));
        return [];
      }
      return [result.image];
    });
    const acceptedImages = loadedImages.slice(0, Math.max(0, MAX_FILES - imageCountRef.current));
    if (acceptedImages.length < loadedImages.length) toast.error(messages.tooManyImages);
    if (acceptedImages.length === 0) return;
    imageCountRef.current += acceptedImages.length;
    draft.setImages((previousImages) => [
      ...previousImages,
      ...acceptedImages.slice(0, Math.max(0, MAX_FILES - previousImages.length)),
    ]);
  };

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;

    fireAndForget(appendFiles(files), {
      context: "SourceDocumentInput.processFiles",
    });
  };

  const handleTextareaPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files: File[] = [];

    for (const item of Array.from(event.clipboardData.items)) {
      if (!item.type.startsWith("image/")) continue;

      const file = item.getAsFile();
      if (file != null) {
        files.push(file);
      }
    }

    if (files.length === 0) return;

    fireAndForget(appendFiles(files), {
      context: "SourceDocumentInput.processFiles",
    });
  };

  const handleSubmit = () => {
    if (!draft.canSubmit) return;

    submitMutations.submit(buildSubmitPayload(draft.text, draft.images, draft.entryDate, timeZone));
  };

  const addImageFiles = (files: File[]) => {
    if (files.length === 0) return;
    fireAndForget(appendFiles(files), { context: "SourceDocumentInput.addImages" });
  };

  const [isCameraOpen, setIsCameraOpen] = useState(true);
  const isTouchInput = useIsTouchInput();
  const camera = useCameraCapture({
    enabled:
      isTouchInput &&
      mode === "create" &&
      options.isActive !== false &&
      isCameraOpen &&
      !submitMutations.isPending,
    onCapture: (file) => addImageFiles([file]),
  });

  return {
    mode,
    text: draft.text,
    entryDate: draft.entryDate,
    images: draft.modalImages,
    selectedImageIndex: draft.selectedImageIndex,
    fileInputRef,
    isPending: pendingFileCount > 0 || submitMutations.isPending,
    isPreparingImages: pendingFileCount > 0,
    isSubmitting: submitMutations.isPending,
    progress: submitMutations.progress,
    canCancelUpload: submitMutations.canCancel,
    canSubmit: draft.canSubmit && pendingFileCount === 0,
    isDirty: draft.isDirty || pendingFileCount > 0,
    remainingImageSlots: Math.max(0, MAX_FILES - draft.images.length - pendingFileCount),
    isTouchInput,
    camera,
    isCameraOpen,
    openCamera: () => setIsCameraOpen(true),
    collapseCamera: () => setIsCameraOpen(false),
    setText: draft.setText,
    setEntryDate: draft.setEntryDate,
    openImage: draft.openImage,
    closeImage: draft.closeImage,
    removeImage: draft.removeImage,
    addImageFiles,
    triggerFileDialog: () => fileInputRef.current?.click(),
    handleFileInputChange,
    handleTextareaPaste,
    handleSubmit,
    cancelUpload: submitMutations.cancel,
  };
}
