"use client";

import { useEffect, useRef, useState, type SetStateAction } from "react";
import type {
  EditableInputImage,
  SourceDocumentInputInitialData,
} from "./source-document-input-controller.types";
import {
  resolveInitialEntryDate,
  releaseEditableImage,
  toEditableImages,
  toModalImages,
} from "./source-document-input-controller.core";

interface UseSourceDocumentInputDraftOptions {
  initialData?: SourceDocumentInputInitialData;
  timeZone?: string;
}

interface InitialDraftSnapshot {
  text: string;
  images: EditableInputImage[];
}

interface DraftDateState {
  entryDate: Date;
  /** The date the dirty check compares against. */
  baseline: number;
  /** True once the user picked a date by hand in this draft. */
  touched: boolean;
  /** The zone `entryDate` was resolved for. */
  timeZone: string | undefined;
}

function createDraftDateState(
  initialData: SourceDocumentInputInitialData | undefined,
  timeZone: string | undefined
): DraftDateState {
  const entryDate = resolveInitialEntryDate(initialData?.entryDate, timeZone);
  return { entryDate, baseline: entryDate.getTime(), touched: false, timeZone };
}

function areImagesEqual(left: EditableInputImage[], right: EditableInputImage[]) {
  return (
    left.length === right.length &&
    left.every((image, index) => {
      const other = right[index];
      return (
        other != null &&
        image.data === other.data &&
        image.mimeType === other.mimeType &&
        image.storedFileId === other.storedFileId
      );
    })
  );
}

export function useSourceDocumentInputDraft({
  initialData,
  timeZone,
}: UseSourceDocumentInputDraftOptions) {
  const [text, setText] = useState(initialData?.text ?? "");
  const [images, setImages] = useState<EditableInputImage[]>(() =>
    toEditableImages(initialData?.images)
  );
  const [dateState, setDateState] = useState<DraftDateState>(() =>
    createDraftDateState(initialData, timeZone)
  );
  const [initialDraft, setInitialDraft] = useState<InitialDraftSnapshot>(() => ({
    text: initialData?.text ?? "",
    images: toEditableImages(initialData?.images),
  }));
  const [selectedImageIndex, setSelectedImageIndex] = useState<number | null>(null);
  const imagesRef = useRef(images);

  const replaceImages = (update: SetStateAction<EditableInputImage[]>) => {
    setImages((current) => {
      const next = typeof update === "function" ? update(current) : update;
      for (const image of current) {
        if (!next.includes(image)) releaseEditableImage(image);
      }
      return next;
    });
  };

  const resetDraft = () => {
    setText("");
    replaceImages([]);
    setDateState(createDraftDateState(undefined, timeZone));
    setInitialDraft({ text: "", images: [] });
    setSelectedImageIndex(null);
  };

  // The record's book can change while the dialog stays open, and its zone
  // owns the default date. An untouched default follows the new zone, while a
  // hand-picked date or a retry seed keeps its own. The baseline moves with an
  // untouched default so the form still closes without a discard confirmation.
  if (dateState.timeZone !== timeZone) {
    setDateState((current) =>
      current.timeZone === timeZone
        ? current
        : current.touched || initialData?.entryDate != null
          ? { ...current, timeZone }
          : createDraftDateState(undefined, timeZone)
    );
  }

  const setEntryDate = (date: Date) => {
    setDateState((current) => ({ ...current, entryDate: date, touched: true }));
  };

  const entryDate = dateState.entryDate;

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);

  useEffect(
    () => () => {
      imagesRef.current.forEach(releaseEditableImage);
    },
    []
  );

  return {
    text,
    setText,
    images,
    setImages: replaceImages,
    modalImages: toModalImages(images),
    entryDate,
    setEntryDate,
    selectedImageIndex,
    openImage: (index: number) => setSelectedImageIndex(index),
    closeImage: () => setSelectedImageIndex(null),
    removeImage: (index: number) =>
      replaceImages((previousImages) =>
        previousImages.filter((_, imageIndex) => imageIndex !== index)
      ),
    canSubmit: text !== "" || images.length > 0,
    isDirty:
      text !== initialDraft.text ||
      !areImagesEqual(images, initialDraft.images) ||
      entryDate.getTime() !== dateState.baseline,
    resetDraft,
  };
}
