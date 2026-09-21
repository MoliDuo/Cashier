/**
 * Image Processing Utilities Tests
 */

import { describe, it, expect } from "vitest";
import {
  processImage,
  isSupportedImageFormat,
  getImageDimensions,
  validateStoredImageBytes,
} from "@/lib/storage/image-processing";
import sharp from "sharp";

describe("image-processing", () => {
  // Create a simple test image buffer
  async function createTestImage(
    width: number,
    height: number,
    format: "jpeg" | "png" | "webp" = "jpeg"
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const buffer = await sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    })
      .toFormat(format)
      .toBuffer();

    const mimeTypes = {
      jpeg: "image/jpeg",
      png: "image/png",
      webp: "image/webp",
    };

    return { buffer, mimeType: mimeTypes[format] };
  }

  describe("processImage", () => {
    it("should compress JPEG image", async () => {
      const { buffer, mimeType } = await createTestImage(1000, 1000, "jpeg");

      const result = await processImage(buffer, mimeType);

      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.buffer.length).toBeGreaterThan(0);
      expect(result.mimeType).toBe("image/webp"); // Converts to WebP by default
    });

    it("should keep PNG format for transparency", async () => {
      const { buffer, mimeType } = await createTestImage(500, 500, "png");

      const result = await processImage(buffer, mimeType);

      expect(result.mimeType).toBe("image/png"); // PNGs stay as PNG
    });

    it("should resize image exceeding max dimension", async () => {
      const { buffer, mimeType } = await createTestImage(3000, 3000, "jpeg");

      const result = await processImage(buffer, mimeType, {
        maxDimension: 1024,
      });

      // Check dimensions
      const dimensions = await getImageDimensions(result.buffer);
      expect(dimensions?.width).toBeLessThanOrEqual(1024);
      expect(dimensions?.height).toBeLessThanOrEqual(1024);
    });

    it("should not enlarge small images", async () => {
      const { buffer, mimeType } = await createTestImage(100, 100, "jpeg");

      const result = await processImage(buffer, mimeType, {
        maxDimension: 1024,
      });

      const dimensions = await getImageDimensions(result.buffer);
      expect(dimensions?.width).toBe(100);
      expect(dimensions?.height).toBe(100);
    });

    it("should convert to specified format", async () => {
      const { buffer, mimeType } = await createTestImage(500, 500, "jpeg");

      const result = await processImage(buffer, mimeType, {
        format: "png",
      });

      expect(result.mimeType).toBe("image/png");
    });

    it("should adjust quality", async () => {
      const { buffer, mimeType } = await createTestImage(1000, 1000, "jpeg");

      const highQuality = await processImage(buffer, mimeType, {
        quality: 90,
        format: "jpeg",
      });

      const lowQuality = await processImage(buffer, mimeType, {
        quality: 50,
        format: "jpeg",
      });

      // Lower quality should generally produce smaller file (though not guaranteed)
      expect(lowQuality.buffer.length).toBeLessThanOrEqual(
        highQuality.buffer.length + 1000 // Allow small margin
      );
    });

    it("should throw on invalid buffer instead of returning original bytes", async () => {
      const invalidBuffer = Buffer.from("not an image");

      await expect(processImage(invalidBuffer, "image/jpeg")).rejects.toThrow(Error);
    });

    it("should return processed output even if larger than original", async () => {
      // Create a very small compressed image
      const buffer = await sharp({
        create: { width: 10, height: 10, channels: 3, background: { r: 0, g: 0, b: 0 } },
      })
        .jpeg({ quality: 1 })
        .toBuffer();

      const result = await processImage(buffer, "image/jpeg");

      // Should return processed buffer (not the original fallback)
      expect(result.buffer).toBeInstanceOf(Buffer);
      expect(result.buffer.length).toBeGreaterThan(0);
    });
  });

  describe("isSupportedImageFormat", () => {
    it("accepts upload image formats case-insensitively and rejects other content", () => {
      for (const mime of [
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif",
        "image/avif",
        "IMAGE/JPEG",
        "Image/Png",
      ]) {
        expect(isSupportedImageFormat(mime)).toBe(true);
      }
      for (const mime of [
        "application/pdf",
        "text/plain",
        "image/svg+xml",
        "image/jpg",
        "image/tiff",
      ]) {
        expect(isSupportedImageFormat(mime)).toBe(false);
      }
    });
  });

  describe("validateStoredImageBytes", () => {
    it("fully decodes supported bytes with matching MIME", async () => {
      const { buffer } = await createTestImage(20, 20, "png");
      await expect(validateStoredImageBytes(buffer, "image/png")).resolves.toBeUndefined();
    });

    it("rejects malformed bytes and declared MIME mismatches", async () => {
      await expect(
        validateStoredImageBytes(Buffer.from("not-an-image"), "image/jpeg")
      ).rejects.toThrow(Error);
      const { buffer } = await createTestImage(20, 20, "png");
      await expect(validateStoredImageBytes(buffer, "image/jpeg")).rejects.toThrow(
        "does not match"
      );
    });
  });

  describe("getImageDimensions", () => {
    it("should return dimensions for valid image", async () => {
      const { buffer } = await createTestImage(800, 600, "jpeg");

      const dimensions = await getImageDimensions(buffer);

      expect(dimensions).toEqual({ width: 800, height: 600 });
    });

    it("should return null for invalid buffer", async () => {
      const invalidBuffer = Buffer.from("not an image");

      const dimensions = await getImageDimensions(invalidBuffer);

      expect(dimensions).toBeNull();
    });
  });
});
