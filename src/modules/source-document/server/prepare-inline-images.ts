import type {
  StoredFileContract,
  UploadFileRequestContract,
  UploadFinalizationContract,
  UploadPlanContract,
} from "@/application/contracts";
import { ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { logIdentifier } from "@/lib/security/log-identifier";
import type { PreparedInlineImage } from "@/modules/source-document/api-v1-policy";

/**
 * Interface for the stored-files operations needed by prepareInlineImages.
 * This is a narrow local dependency shape — deliberately not the full
 * StoredFilePort so the helper stays testable without the rest of the
 * storage machinery.
 */
export interface InlineImageUploader {
  createUploadPlan(
    ledgerId: string,
    files: readonly UploadFileRequestContract[]
  ): Promise<UploadPlanContract>;
  uploadTarget(input: {
    ledgerId: string;
    uploadSessionId: string;
    targetId: string;
    contentType: string;
    body: Uint8Array;
  }): Promise<StoredFileContract>;
  finalizeUpload(input: UploadFinalizationContract): Promise<readonly StoredFileContract[]>;
  abandonUploadSession(ledgerId: string, uploadSessionId: string): Promise<void>;
}

export type ImageProcessor = (
  buffer: Buffer,
  mimeType: string
) => Promise<{ buffer: Buffer; mimeType: string }>;

/**
 * Process already-decoded images via Sharp, upload them to internal storage,
 * and finalize the batch. Returns stored-file IDs in input order.
 *
 * Every image is decoded and processed before any upload begins, so a single
 * upload plan covers the exact processed size / content-type. If *any* image
 * fails to decode or process, no upload plan or durable state is created.
 */
export async function prepareInlineImages(
  images: PreparedInlineImage[],
  storedFiles: InlineImageUploader,
  processImage: ImageProcessor,
  ledgerId: string
): Promise<{ storedFileIds: string[]; uploadSessionId: string }> {
  // Process every image before creating durable upload state.
  const processedImages = await Promise.all(
    images.map(async (img) => {
      const processed = await processImage(img.bytes, img.mimeType);
      return { buffer: processed.buffer, mimeType: processed.mimeType };
    })
  );

  // Phase 2: create a single upload plan covering all images
  const plan = await storedFiles.createUploadPlan(
    ledgerId,
    processedImages.map((img) => ({
      contentType: img.mimeType,
      byteSize: img.buffer.length,
      originalFilename: null,
    }))
  );
  const abandon = async () => {
    try {
      await storedFiles.abandonUploadSession(ledgerId, plan.id);
    } catch {
      logger.error(
        {
          ledgerSubject: logIdentifier("ledger", ledgerId),
          uploadSessionSubject: logIdentifier("upload-session", plan.id),
        },
        "Failed to abandon source-document upload session"
      );
    }
  };
  try {
    if (plan.targets.length !== processedImages.length) {
      throw new ValidationError("Upload plan target count does not match the request");
    }
    await Promise.all(
      plan.targets.map(async (target, index) => {
        const processed = processedImages[index]!;
        await storedFiles.uploadTarget({
          ledgerId,
          uploadSessionId: plan.id,
          targetId: target.id,
          contentType: processed.mimeType,
          body: new Uint8Array(processed.buffer),
        });
      })
    );
    const finalized = await storedFiles.finalizeUpload({
      uploadSessionId: plan.id,
      finalizationToken: plan.finalizationToken,
      targetIds: plan.targets.map((t) => t.id),
    });
    if (finalized.length !== processedImages.length) {
      throw new ValidationError("Finalized file count does not match the request");
    }
    return { storedFileIds: finalized.map((file) => file.id), uploadSessionId: plan.id };
  } catch (error) {
    await abandon();
    throw error;
  }
}
