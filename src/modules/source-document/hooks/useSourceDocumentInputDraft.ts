"use client";

import { useEffect, useRef, useState, type SetStateAction } from "react";
import {
  clearDraft,
  keepDraftInMemory,
  readDraft,
  takeDraftFromMemory,
  writeDraft,
} from "@/lib/drafts";
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
  /** Where this form's unsaved input is kept; null keeps it only while mounted. */
  draftKey?: string | null;
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

/** What survives a reload: the images do not, being files the browser picked. */
interface StoredInputDraft {
  text: string;
  /** A hand-picked date, as epoch milliseconds; null keeps the default. */
  entryDate: number | null;
}

/** The whole draft, kept in memory while the page lives. */
interface MemoryInputDraft {
  text: string;
  images: EditableInputImage[];
  dateState: DraftDateState;
}

function parseStoredInputDraft(data: unknown): StoredInputDraft | null {
  if (data == null || typeof data !== "object") return null;
  const { text, entryDate } = data as Record<string, unknown>;
  if (typeof text !== "string") return null;
  if (entryDate !== null && (typeof entryDate !== "number" || !Number.isFinite(entryDate))) {
    return null;
  }
  return { text, entryDate };
}

function restoreDraft(
  key: string | null,
  initialData: SourceDocumentInputInitialData | undefined,
  timeZone: string | undefined
): MemoryInputDraft | null {
  if (key == null) return null;
  const kept = takeDraftFromMemory<MemoryInputDraft>(key);
  if (kept != null) return kept;
  const stored = readDraft(key, parseStoredInputDraft);
  if (stored == null) return null;
  const initialDate = createDraftDateState(initialData, timeZone);
  return {
    text: stored.data.text,
    images: toEditableImages(initialData?.images),
    dateState:
      stored.data.entryDate == null
        ? initialDate
        : { ...initialDate, entryDate: new Date(stored.data.entryDate), touched: true },
  };
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
  draftKey = null,
}: UseSourceDocumentInputDraftOptions) {
  const [restored] = useState(() => restoreDraft(draftKey, initialData, timeZone));
  const [restoredFromDraft, setRestoredFromDraft] = useState(restored != null);
  const [text, setText] = useState(restored?.text ?? initialData?.text ?? "");
  const [images, setImages] = useState<EditableInputImage[]>(
    () => restored?.images ?? toEditableImages(initialData?.images)
  );
  const [dateState, setDateState] = useState<DraftDateState>(
    () => restored?.dateState ?? createDraftDateState(initialData, timeZone)
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

  /** After a submit: the form starts over empty and nothing is kept. */
  const resetDraft = () => {
    setText("");
    replaceImages([]);
    setDateState(createDraftDateState(undefined, timeZone));
    setInitialDraft({ text: "", images: [] });
    setSelectedImageIndex(null);
    setRestoredFromDraft(false);
    if (draftKey != null) clearDraft(draftKey);
  };

  /** Drops the kept input and goes back to what the form opened with. */
  const discardDraft = () => {
    setText(initialDraft.text);
    replaceImages(toEditableImages(initialData?.images));
    setDateState(createDraftDateState(initialData, timeZone));
    setSelectedImageIndex(null);
    setRestoredFromDraft(false);
    if (draftKey != null) clearDraft(draftKey);
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
  const isDirty =
    text !== initialDraft.text ||
    !areImagesEqual(images, initialDraft.images) ||
    entryDate.getTime() !== dateState.baseline;

  const latestRef = useRef({ text, images, dateState, isDirty, draftKey });
  useEffect(() => {
    imagesRef.current = images;
    latestRef.current = { text, images, dateState, isDirty, draftKey };
  }, [dateState, draftKey, images, isDirty, text]);

  useEffect(() => {
    if (draftKey == null) return;
    if (!isDirty) {
      clearDraft(draftKey);
      return;
    }
    const stored: StoredInputDraft = {
      text,
      entryDate: dateState.touched ? dateState.entryDate.getTime() : null,
    };
    writeDraft(draftKey, stored);
  }, [dateState, draftKey, isDirty, text]);

  // Closing the form keeps an unsaved draft, images included, for the next
  // opening on this page; only a clean form lets its images go.
  useEffect(
    () => () => {
      const latest = latestRef.current;
      if (latest.draftKey != null && latest.isDirty) {
        const kept: MemoryInputDraft = {
          text: latest.text,
          images: latest.images,
          dateState: latest.dateState,
        };
        keepDraftInMemory(latest.draftKey, kept);
        return;
      }
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
    isDirty,
    /** True while the form shows input restored from an earlier visit. */
    restoredFromDraft: restoredFromDraft && isDirty,
    resetDraft,
    discardDraft,
  };
}
