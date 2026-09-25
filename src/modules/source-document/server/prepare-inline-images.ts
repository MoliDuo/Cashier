import "server-only";
import { processImage } from "@/lib/storage/image-processing";
import type { PreparedInlineImage } from "@/modules/source-document/api-v1-policy";
import { storeProcessedImages } from "@/server/stored-files/uploads";

/**
 * Normalizes already-decoded images with Sharp and stores them as ready files.
 * Every image is processed before anything is stored, so one that fails to
 * decode leaves no durable state. Returns stored-file ids in input order.
 */
export async function prepareInlineImages(
  images: PreparedInlineImage[],
  ledgerId: string
): Promise<{ storedFileIds: string[] }> {
  const processed = await Promise.all(
    images.map((image) => processImage(image.bytes, image.mimeType))
  );
  return {
    storedFileIds: await storeProcessedImages(
      ledgerId,
      processed.map((image) => ({ bytes: image.buffer, contentType: image.mimeType }))
    ),
  };
}
