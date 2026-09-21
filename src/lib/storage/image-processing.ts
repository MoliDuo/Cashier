/**
 * Image Processing Utilities
 *
 * Provides image compression, resizing, and format optimization using sharp.
 * Enforces the shared Web upload policy for pixel limits, format support,
 * and decode security.
 */

import sharp from "sharp";
import { runtimeEnv } from "@/lib/env/runtime";
import { ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import {
  MAX_NORMALIZED_BYTES_PER_FILE,
  MAX_MEGAPIXELS_PER_FILE,
  SUPPORTED_MIME_SET,
  validateImageProcessing,
  sanitizeMimeType,
} from "@/lib/storage/upload-policy";

/**
 * Image processing options
 */
export interface ImageProcessingOptions {
  /** Maximum width/height in pixels (default: 2048) */
  maxDimension?: number;
  /** JPEG/WebP quality 1-100 (default: 85) */
  quality?: number;
  /** Output format (default: auto - keep original or convert to WebP) */
  format?: "jpeg" | "png" | "webp" | "avif" | "auto";
  /** Whether to strip metadata (default: true) */
  stripMetadata?: boolean;
}

/**
 * Get default image quality from environment or use fallback
 */
const getDefaultQuality = (): number => runtimeEnv.maxImageQuality;

/**
 * Default processing options optimized for receipt/invoice images
 */
export const DEFAULT_IMAGE_OPTIONS: Required<ImageProcessingOptions> = {
  maxDimension: 2048,
  get quality() {
    return getDefaultQuality();
  },
  format: "auto",
  stripMetadata: true,
};

/**
 * Maximum output file size (from policy)
 */
const MAX_OUTPUT_SIZE = MAX_NORMALIZED_BYTES_PER_FILE;

/**
 * Maximum number of quality-reduction retries before giving up.
 */
const MAX_RETRIES = 3;

/**
 * Limit input pixels for Sharp. Uses the environment value which defaults
 * to 25 MP (higher than the policy 16 MP to allow a controlled error path).
 */
const MAX_INPUT_PIXELS = MAX_MEGAPIXELS_PER_FILE * 1_000_000 * 1.5;

/**
 * Process and compress an image buffer
 *
 * @param buffer - Input image buffer
 * @param mimeType - Declared input MIME type (may be overridden by detected content)
 * @param options - Processing options
 * @returns Processed buffer and trusted output MIME type
 * @throws {Error} If the image cannot be decoded or violates policy limits
 */
export async function processImage(
  buffer: Buffer,
  mimeType: string,
  options: ImageProcessingOptions = {},
  retryCount: number = 0
): Promise<{ buffer: Buffer; mimeType: string }> {
  const opts = { ...DEFAULT_IMAGE_OPTIONS, ...options };

  try {
    let pipeline = sharp(buffer, {
      limitInputPixels: Math.round(MAX_INPUT_PIXELS),
    });

    // Get image metadata to determine the actual input format
    const metadata = await pipeline.metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;

    // Validate decoded metadata against policy
    validateImageProcessing({
      width,
      height,
      format: metadata.format ?? "unknown",
    });

    // Determine trusted MIME from decoded content, not client headers
    const detectedFormat = metadata.format ?? "";
    const trustedMime = sanitizeMimeType(mimeType, formatToMimeType(detectedFormat));

    // Resize if dimensions exceed max
    const maxDim = opts.maxDimension;
    if (width > maxDim || height > maxDim) {
      pipeline = pipeline.resize(maxDim, maxDim, {
        fit: "inside",
        withoutEnlargement: true,
      });
    }

    // Determine output format
    let outputFormat = opts.format;
    if (outputFormat === "auto") {
      // Use the trusted MIME to decide output format
      outputFormat = trustedMime === "image/png" ? "png" : "webp";
    }

    // Apply format-specific compression
    let outputBuffer: Buffer;
    let outputMimeType: string;

    switch (outputFormat) {
      case "jpeg":
        outputBuffer = await pipeline
          .jpeg({
            quality: opts.quality,
            progressive: true,
            mozjpeg: true,
          })
          .toBuffer();
        outputMimeType = "image/jpeg";
        break;

      case "png":
        outputBuffer = await pipeline
          .png({
            compressionLevel: 9,
            progressive: true,
          })
          .toBuffer();
        outputMimeType = "image/png";
        break;

      case "webp":
        outputBuffer = await pipeline
          .webp({
            quality: opts.quality,
            effort: 6,
          })
          .toBuffer();
        outputMimeType = "image/webp";
        break;

      case "avif":
        outputBuffer = await pipeline
          .avif({
            quality: opts.quality,
            effort: 4,
          })
          .toBuffer();
        outputMimeType = "image/avif";
        break;

      default:
        // Keep original format with compression
        if (trustedMime === "image/jpeg") {
          outputBuffer = await pipeline
            .jpeg({
              quality: opts.quality,
              progressive: true,
              mozjpeg: true,
            })
            .toBuffer();
          outputMimeType = "image/jpeg";
        } else if (trustedMime === "image/png") {
          outputBuffer = await pipeline
            .png({
              compressionLevel: 9,
              progressive: true,
            })
            .toBuffer();
          outputMimeType = "image/png";
        } else if (trustedMime === "image/webp") {
          outputBuffer = await pipeline
            .webp({
              quality: opts.quality,
              effort: 6,
            })
            .toBuffer();
          outputMimeType = "image/webp";
        } else {
          // Default to JPEG for unknown formats
          outputBuffer = await pipeline
            .jpeg({
              quality: opts.quality,
              progressive: true,
            })
            .toBuffer();
          outputMimeType = "image/jpeg";
        }
    }

    // Final size check — use the processed output regardless of size comparison
    // (the original bytes have been decoded by sharp and are trusted, but we
    // always store the processed version for consistency)
    if (outputBuffer.length > MAX_OUTPUT_SIZE) {
      if (retryCount >= MAX_RETRIES || outputMimeType === "image/png" || opts.quality <= 60) {
        throw new ValidationError(
          "Unable to compress image within size limit using the permitted encoding settings"
        );
      }
      logger.warn(
        { size: outputBuffer.length, maxSize: MAX_OUTPUT_SIZE, retryCount: retryCount + 1 },
        "Processed image exceeds max size, retrying with lower quality"
      );
      // Attempt another pass with lower quality
      return processImage(
        buffer,
        mimeType,
        {
          ...opts,
          quality: Math.max(60, opts.quality - 15),
        },
        retryCount + 1
      );
    }

    logger.debug(
      {
        originalSize: buffer.length,
        processedSize: outputBuffer.length,
        originalMime: mimeType,
        outputMime: outputMimeType,
        trustedMime,
        width,
        height,
      },
      "Image processed successfully"
    );

    return { buffer: outputBuffer, mimeType: outputMimeType };
  } catch (error) {
    // Sharp decode/processing failure is terminal — do not return unverified original bytes
    logger.error({ error, mimeType }, "Image processing failed");
    throw error;
  }
}

export async function validateStoredImageBytes(
  buffer: Buffer,
  declaredContentType: string
): Promise<void> {
  try {
    const pipeline = sharp(buffer, {
      limitInputPixels: Math.round(MAX_INPUT_PIXELS),
    });
    const metadata = await pipeline.metadata();
    const detectedContentType = formatToMimeType(metadata.format ?? "unknown");
    validateImageProcessing({
      width: metadata.width ?? 0,
      height: metadata.height ?? 0,
      format: metadata.format ?? "unknown",
    });
    if (detectedContentType !== declaredContentType.toLowerCase()) {
      throw new ValidationError("Stored image content does not match its declared MIME type");
    }
    await pipeline.toBuffer();
  } catch (error) {
    logger.error({ error, declaredContentType }, "Stored image content validation failed");
    throw error;
  }
}

/**
 * Map a sharp format string to a MIME type.
 */
function formatToMimeType(format: string): string {
  const map: Record<string, string> = {
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    heic: "image/heic",
    heif: "image/heif",
    avif: "image/avif",
    svg: "image/svg+xml",
    tiff: "image/tiff",
  };
  return map[format.toLowerCase()] ?? `image/${format.toLowerCase()}`;
}

/**
 * Check if a MIME type is a supported image format (Web upload policy).
 */
export function isSupportedImageFormat(mimeType: string): boolean {
  return SUPPORTED_MIME_SET.has(mimeType.toLowerCase());
}

/**
 * Get image dimensions without loading the full image
 */
export async function getImageDimensions(
  buffer: Buffer
): Promise<{ width: number; height: number } | null> {
  try {
    const metadata = await sharp(buffer).metadata();
    if (metadata.width != null && metadata.height != null) {
      return { width: metadata.width, height: metadata.height };
    }
    return null;
  } catch (error) {
    logger.error({ error }, "Failed to get image dimensions");
    return null;
  }
}
