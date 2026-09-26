import { compressImage } from "@/lib/image-utils";
import {
  toEditableFileImage,
  type SourceDocumentInputImageLoadResult,
} from "./source-document-input.core";

export async function loadSourceDocumentInputFiles(
  files: File[],
  signal?: AbortSignal
): Promise<SourceDocumentInputImageLoadResult[]> {
  return Promise.all(
    files.map(async (file): Promise<SourceDocumentInputImageLoadResult> => {
      try {
        const compressed = await compressImage(file, 1080, 1080, 0.8, signal);
        return {
          kind: "ready",
          image: toEditableFileImage(compressed.file, compressed.mimeType),
        };
      } catch (error) {
        console.error("Failed to compress image:", error);
        return { kind: "unsupported", fileName: file.name };
      }
    })
  );
}
