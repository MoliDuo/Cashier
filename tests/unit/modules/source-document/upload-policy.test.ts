/**
 * Upload Policy Unit Tests
 */

import { describe, it, expect } from "vitest";
import {
  MAX_FILES,
  MAX_ORIGINAL_BYTES_PER_FILE,
  MAX_NORMALIZED_BYTES_PER_REVISION,
  MAX_MEGAPIXELS_PER_FILE,
  SUPPORTED_MIME_TYPES,
  validateFileUpload,
  validateImageProcessing,
  validateRevisionUpload,
  validateFileCount,
  validateAggregateFileCount,
  sanitizeMimeType,
} from "@/lib/storage/upload-policy";

describe("validateFileUpload", () => {
  it("accepts every supported type through the maximum file size", () => {
    for (const contentType of SUPPORTED_MIME_TYPES) {
      expect(() => validateFileUpload({ contentType, byteSize: 1 })).not.toThrow();
    }
    expect(() =>
      validateFileUpload({ contentType: "image/png", byteSize: MAX_ORIGINAL_BYTES_PER_FILE })
    ).not.toThrow();
  });

  it("rejects unsupported types and invalid or oversized byte counts", () => {
    for (const byteSize of [0, -1, 1.5]) {
      expect(() => validateFileUpload({ contentType: "image/jpeg", byteSize })).toThrow(
        "Invalid byte size"
      );
    }
    expect(() => validateFileUpload({ contentType: "application/pdf", byteSize: 1 })).toThrow(
      "Unsupported content type"
    );
    expect(() =>
      validateFileUpload({
        contentType: "image/jpeg",
        byteSize: MAX_ORIGINAL_BYTES_PER_FILE + 1,
      })
    ).toThrow("exceeds maximum original size");
  });
});

describe("validateImageProcessing", () => {
  it("accepts supported image formats within the pixel limit", () => {
    for (const format of ["jpeg", "png", "webp"]) {
      expect(() => validateImageProcessing({ width: 100, height: 100, format })).not.toThrow();
    }
    expect(() =>
      validateImageProcessing({
        width: MAX_MEGAPIXELS_PER_FILE * 1_000_000,
        height: 1,
        format: "jpeg",
      })
    ).not.toThrow();
  });

  it("rejects oversized dimensions and unsupported formats", () => {
    expect(() => validateImageProcessing({ width: 5000, height: 4000, format: "jpeg" })).toThrow(
      "exceed maximum"
    );
    expect(() => validateImageProcessing({ width: 100, height: 100, format: "tiff" })).toThrow(
      "Unsupported image format"
    );
  });
});

describe("validateRevisionUpload", () => {
  it("accepts the aggregate boundary and rejects one byte over it", () => {
    expect(() => validateRevisionUpload(0, MAX_NORMALIZED_BYTES_PER_REVISION)).not.toThrow();
    expect(() =>
      validateRevisionUpload(
        MAX_NORMALIZED_BYTES_PER_REVISION / 2,
        MAX_NORMALIZED_BYTES_PER_REVISION / 2
      )
    ).not.toThrow();
    expect(() => validateRevisionUpload(MAX_NORMALIZED_BYTES_PER_REVISION, 1)).toThrow(
      "exceeds revision limit"
    );
  });
});

describe("validateFileCount", () => {
  it("accepts the count boundaries and rejects values outside them", () => {
    expect(() => validateFileCount(1)).not.toThrow();
    expect(() => validateFileCount(MAX_FILES)).not.toThrow();
    expect(() => validateFileCount(0)).toThrow("must be between 1 and");
    expect(() => validateFileCount(-1)).toThrow("must be between 1 and");
    expect(() => validateFileCount(MAX_FILES + 1)).toThrow("must be between 1 and");
  });
});

describe("validateAggregateFileCount", () => {
  it("accepts aggregate count boundaries and rejects any combination over the limit", () => {
    expect(() => validateAggregateFileCount(0, 0, 0)).not.toThrow();
    expect(() => validateAggregateFileCount(MAX_FILES, 0, 0)).not.toThrow();
    expect(() => validateAggregateFileCount(1, MAX_FILES - 1, 0)).not.toThrow();
    for (const counts of [
      [MAX_FILES, 1, 0],
      [MAX_FILES - 1, 2, 0],
      [0, 0, MAX_FILES + 1],
    ] as const) {
      expect(() => validateAggregateFileCount(counts[0], counts[1], counts[2])).toThrow(
        `exceeds maximum of ${MAX_FILES} files`
      );
    }
  });
});

describe("sanitizeMimeType", () => {
  it("prefers a supported detected MIME and otherwise falls back to the declaration", () => {
    expect(sanitizeMimeType("image/gif", "image/png")).toBe("image/png");
    expect(sanitizeMimeType("image/png", null)).toBe("image/png");
    expect(sanitizeMimeType("image/jpeg", "image/tiff")).toBe("image/jpeg");
    expect(sanitizeMimeType("IMAGE/JPEG", null)).toBe("image/jpeg");
    expect(sanitizeMimeType("image/gif", "IMAGE/PNG")).toBe("image/png");
    expect(sanitizeMimeType("image/webp", "")).toBe("image/webp");
  });

  it("rejects when neither MIME value is supported", () => {
    expect(() => sanitizeMimeType("image/tiff", "image/bmp")).toThrow("Unsupported MIME type");
    expect(() => sanitizeMimeType("", null)).toThrow("Unsupported MIME type");
  });
});
