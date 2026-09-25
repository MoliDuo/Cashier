"use client";

import { compressImage } from "@/lib/image-utils";
import {
  MAX_FILES,
  MAX_NORMALIZED_BYTES_PER_REVISION,
  MAX_ORIGINAL_BYTES_PER_FILE,
} from "@/lib/storage/upload-policy";
import type { SourceDocumentSubmitPayload } from "./source-document-input-controller.types";
import {
  createSourceDocumentUploadPlanAction,
  finalizeSourceDocumentUploadAction,
} from "@/modules/source-document/server-actions/uploads";

export interface SourceDocumentSubmissionProgress {
  phase:
    | "preparing"
    | "planning"
    | "uploading"
    | "finalizing"
    | "submitting"
    | "cancelling"
    | "complete";
  percent: number;
  loadedBytes?: number;
  totalBytes?: number;
  fileIndex?: number;
  fileCount?: number;
}

export type SourceDocumentSubmissionUploadStage = "prepare" | "plan" | "upload" | "finalize";

export class SourceDocumentSubmissionUploadError extends Error {
  constructor(
    message: string,
    public readonly stage: SourceDocumentSubmissionUploadStage,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "SourceDocumentSubmissionUploadError";
  }
}

interface InlinePreparationDependencies {
  compress?: typeof compressImage;
  createPlan?: typeof createSourceDocumentUploadPlanAction;
  finalize?: typeof finalizeSourceDocumentUploadAction;
  put?: typeof fetch;
  signal?: AbortSignal;
}

const QUALITY_STEPS = [0.78, 0.68, 0.58, 0.48, 0.38] as const;

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new DOMException("Upload aborted", "AbortError");
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function filesFitUploadLimits(files: readonly File[]): boolean {
  return (
    files.every((file) => file.size <= MAX_ORIGINAL_BYTES_PER_FILE) &&
    files.reduce((total, file) => total + file.size, 0) <= MAX_NORMALIZED_BYTES_PER_REVISION
  );
}

function submissionBase(payload: SourceDocumentSubmitPayload): SourceDocumentSubmitPayload {
  return {
    documentDate: payload.documentDate,
    ...(payload.timezone == null ? {} : { timezone: payload.timezone }),
    text: payload.text,
    storedFileIds: payload.storedFileIds,
  };
}

async function sha256(file: File, signal?: AbortSignal): Promise<string> {
  throwIfAborted(signal);
  const buffer = await file.arrayBuffer();
  throwIfAborted(signal);
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  throwIfAborted(signal);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function uploadSourceDocumentSubmissionImages(
  payload: SourceDocumentSubmitPayload,
  dependencies: InlinePreparationDependencies = {},
  onProgress?: (progress: SourceDocumentSubmissionProgress) => void
): Promise<SourceDocumentSubmitPayload> {
  const images = payload.images ?? [];
  const base = submissionBase(payload);
  if (images.length === 0) return base;
  if (images.length + payload.storedFileIds.length > MAX_FILES) {
    throw new SourceDocumentSubmissionUploadError(`Maximum ${MAX_FILES} images allowed`, "prepare");
  }

  onProgress?.({ phase: "preparing", percent: 0, fileCount: images.length });
  const originals = images.map((image) => image.file);
  const compress = dependencies.compress ?? compressImage;

  let files: File[] | null = filesFitUploadLimits(originals) ? originals : null;
  if (files == null) {
    for (let qualityIndex = 0; qualityIndex < QUALITY_STEPS.length; qualityIndex += 1) {
      throwIfAborted(dependencies.signal);
      const quality = QUALITY_STEPS[qualityIndex]!;
      let compressed;
      try {
        compressed = await Promise.all(
          originals.map((file) => compress(file, 1080, 1080, quality, dependencies.signal))
        );
      } catch (error) {
        if (dependencies.signal?.aborted === true || isAbortError(error)) {
          throwIfAborted(dependencies.signal);
          throw error;
        }
        throw new SourceDocumentSubmissionUploadError(
          "Failed to compress source image",
          "prepare",
          {
            cause: error,
          }
        );
      }
      throwIfAborted(dependencies.signal);
      const candidates = compressed.map((image) => image.file);
      onProgress?.({
        phase: "preparing",
        percent: Math.min(80, 15 + qualityIndex * 15),
        fileCount: candidates.length,
      });
      if (filesFitUploadLimits(candidates)) {
        files = candidates;
        break;
      }
    }
  }
  if (files == null) {
    throw new SourceDocumentSubmissionUploadError(
      "Images cannot be compressed within the upload size limit",
      "prepare"
    );
  }

  try {
    throwIfAborted(dependencies.signal);
    onProgress?.({ phase: "planning", percent: 55, fileCount: files.length });
    const checksums = await Promise.all(files.map((file) => sha256(file, dependencies.signal)));
    throwIfAborted(dependencies.signal);
    const plan = await (dependencies.createPlan ?? createSourceDocumentUploadPlanAction)(
      files.map((file, index) => ({
        contentType: file.type,
        byteSize: file.size,
        originalFilename: file.name,
        checksum: checksums[index]!,
      }))
    );
    throwIfAborted(dependencies.signal);
    let loadedBytes = 0;
    const totalBytes = files.reduce((total, file) => total + file.size, 0);
    let nextIndex = 0;
    const uploadWorker = async () => {
      while (nextIndex < plan.targets.length) {
        const index = nextIndex++;
        const target = plan.targets[index]!;
        const file = files[index]!;
        let response: Response | null = null;
        let lastError: unknown;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          throwIfAborted(dependencies.signal);
          try {
            response = await (dependencies.put ?? fetch)(target.url, {
              method: "PUT",
              headers: target.requiredHeaders,
              body: file,
              ...(dependencies.signal === undefined ? {} : { signal: dependencies.signal }),
            });
            if (response.ok) break;
            lastError = new Error(`Direct upload failed with ${response.status}`);
          } catch (error) {
            if (dependencies.signal?.aborted === true || isAbortError(error)) {
              throwIfAborted(dependencies.signal);
              throw error;
            }
            lastError = error;
          }
        }
        throwIfAborted(dependencies.signal);
        if (response?.ok !== true) throw lastError ?? new Error("Direct upload failed");
        loadedBytes += file.size;
        onProgress?.({
          phase: "uploading",
          percent: 55 + Math.round((loadedBytes / totalBytes) * 30),
          loadedBytes,
          totalBytes,
          fileIndex: index,
          fileCount: files.length,
        });
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, files.length) }, uploadWorker));
    throwIfAborted(dependencies.signal);
    onProgress?.({ phase: "finalizing", percent: 88, fileCount: files.length });
    const storedFileIds = await (dependencies.finalize ?? finalizeSourceDocumentUploadAction)({
      storedFileIds: plan.targets.map((target) => target.id),
    });
    return {
      ...base,
      storedFileIds: [...(base.storedFileIds ?? []), ...storedFileIds],
    };
  } catch (error) {
    if (dependencies.signal?.aborted === true || isAbortError(error)) {
      throwIfAborted(dependencies.signal);
      throw error;
    }
    throw new SourceDocumentSubmissionUploadError("Failed to upload source image", "upload", {
      cause: error,
    });
  }
}
