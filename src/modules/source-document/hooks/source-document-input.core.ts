import { formatDateTimeForApi, getDateInTimezone, parseDateString } from "@/lib/date-utils";
import type { SourceDocumentModalImage } from "../ui/SourceDocumentImageModal";
import type { SourceDocumentInputInitialData } from "../ui/source-document-input.types";
import {
  SourceDocumentSubmissionUploadError,
  type SourceDocumentSubmitPayload,
} from "./source-document-submission-upload";

export type EditableInputImage = SourceDocumentModalImage & {
  file?: File;
  objectUrl?: boolean;
};

export type SourceDocumentInputImageLoadResult =
  | { kind: "ready"; image: EditableInputImage }
  | { kind: "too-large"; fileName: string }
  | { kind: "unsupported"; fileName: string };

export function toEditableImage(image: SourceDocumentModalImage): EditableInputImage {
  return { ...image };
}

export function toEditableFileImage(file: File, mimeType = file.type): EditableInputImage {
  return {
    data: URL.createObjectURL(file),
    mimeType,
    file,
    objectUrl: true,
  };
}

export function releaseEditableImage(image: EditableInputImage): void {
  if (image.objectUrl === true) URL.revokeObjectURL(image.data);
}

export function toEditableImages(images?: SourceDocumentModalImage[]) {
  return (images ?? []).map(toEditableImage);
}

export function toModalImages(images: EditableInputImage[]): SourceDocumentModalImage[] {
  return images.map(({ data, mimeType, storedFileId }) => ({
    data,
    mimeType,
    ...(storedFileId == null ? {} : { storedFileId }),
  }));
}

export function areImagesEqual(left: EditableInputImage[], right: EditableInputImage[]) {
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

export function resolveInitialEntryDate(entryDate?: string, timeZone?: string): Date {
  if (entryDate != null) {
    const parsed = parseDateString(entryDate);
    if (!isNaN(parsed.getTime())) return parsed;
  }

  const zonedDate = getDateInTimezone(timeZone);
  return zonedDate != null ? parseDateString(zonedDate) : new Date();
}

export interface DraftDateState {
  entryDate: Date;
  /** The date the dirty check compares against. */
  baseline: number;
  /** True once the user picked a date by hand in this draft. */
  touched: boolean;
  /** The zone `entryDate` was resolved for. */
  timeZone: string | undefined;
}

export function createDraftDateState(
  initialData: SourceDocumentInputInitialData | undefined,
  timeZone: string | undefined
): DraftDateState {
  const entryDate = resolveInitialEntryDate(initialData?.entryDate, timeZone);
  return { entryDate, baseline: entryDate.getTime(), touched: false, timeZone };
}

/** What survives a reload: the images do not, being files the browser picked. */
export interface StoredInputDraft {
  text: string;
  /** A hand-picked date, as epoch milliseconds; null keeps the default. */
  entryDate: number | null;
}

export function parseStoredInputDraft(data: unknown): StoredInputDraft | null {
  if (data == null || typeof data !== "object") return null;
  const { text, entryDate } = data as Record<string, unknown>;
  if (typeof text !== "string") return null;
  if (entryDate !== null && (typeof entryDate !== "number" || !Number.isFinite(entryDate))) {
    return null;
  }
  return { text, entryDate };
}

export function buildSubmitPayload(
  text: string,
  images: EditableInputImage[],
  entryDate: Date,
  timeZone?: string
): SourceDocumentSubmitPayload {
  const newImages = images.flatMap((image) =>
    image.storedFileId == null && image.file != null
      ? [{ file: image.file, mimeType: image.mimeType }]
      : []
  );
  const storedFileIds = images.flatMap((image) =>
    image.storedFileId == null ? [] : [image.storedFileId]
  );
  return {
    documentDate: formatDateTimeForApi(entryDate),
    ...(timeZone != null
      ? { timezone: timeZone }
      : typeof Intl !== "undefined"
        ? { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }
        : {}),
    text: text === "" ? null : text,
    ...(newImages.length > 0 ? { images: newImages } : {}),
    storedFileIds,
  };
}

function arraysEqual<T>(
  left: readonly T[] | undefined,
  right: readonly T[] | undefined,
  equals: (leftItem: T, rightItem: T) => boolean
): boolean {
  const leftLength = left?.length ?? 0;
  if (leftLength !== (right?.length ?? 0)) return false;
  for (let index = 0; index < leftLength; index += 1) {
    if (!equals(left![index]!, right![index]!)) return false;
  }
  return true;
}

export function sourceDocumentPayloadsEqual(
  left: SourceDocumentSubmitPayload,
  right: SourceDocumentSubmitPayload
): boolean {
  return (
    left.documentDate === right.documentDate &&
    left.timezone === right.timezone &&
    left.text === right.text &&
    arraysEqual(left.storedFileIds, right.storedFileIds, (leftId, rightId) => leftId === rightId) &&
    arraysEqual(
      left.images,
      right.images,
      (leftImage, rightImage) =>
        leftImage.file === rightImage.file && leftImage.mimeType === rightImage.mimeType
    )
  );
}

export function snapshotPayload(payload: SourceDocumentSubmitPayload): SourceDocumentSubmitPayload {
  return {
    documentDate: payload.documentDate,
    ...(payload.timezone === undefined ? {} : { timezone: payload.timezone }),
    text: payload.text,
    storedFileIds: [...payload.storedFileIds],
    ...(payload.images === undefined
      ? {}
      : { images: payload.images.map((image) => ({ ...image })) }),
  };
}

export type SubmitErrorMessageKey =
  | "imageReadError"
  | "imageUploadError"
  | "networkError"
  | "validationError"
  | "createError"
  | "retryError";

/**
 * The message a failed submit shows, or null for a cancelled upload, which
 * says nothing. `fallback` is the mode's own failure message.
 */
export function submitErrorMessageKey(
  error: Error,
  fallback: "createError" | "retryError"
): SubmitErrorMessageKey | null {
  if (error instanceof DOMException && error.name === "AbortError") return null;
  if (error instanceof SourceDocumentSubmissionUploadError) {
    return error.stage === "prepare" ? "imageReadError" : "imageUploadError";
  }
  if (typeof navigator !== "undefined" && !navigator.onLine) return "networkError";
  if (
    error instanceof TypeError ||
    /network|fetch failed|request (?:was )?aborted|connection/i.test(error.message)
  ) {
    return "networkError";
  }
  if (/validation|invalid|required|must be/i.test(error.message)) return "validationError";
  return fallback;
}
