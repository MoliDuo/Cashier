import { beforeEach, describe, expect, it, vi } from "vitest";

const { encode, jpeg, png, webp } = vi.hoisted(() => ({
  encode: vi.fn(),
  jpeg: vi.fn(),
  png: vi.fn(),
  webp: vi.fn(),
}));
vi.mock("sharp", () => ({
  default: () => {
    const pipeline = {
      metadata: async () => ({ width: 10, height: 10, format: "png" }),
      jpeg,
      png,
      webp,
      toBuffer: encode,
    };
    jpeg.mockReturnValue(pipeline);
    png.mockReturnValue(pipeline);
    webp.mockReturnValue(pipeline);
    return pipeline;
  },
}));
import { processImage } from "@/lib/storage/image-processing";
import { MAX_NORMALIZED_BYTES_PER_FILE } from "@/lib/storage/upload-policy";

describe("image encoding retry parameters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    encode.mockResolvedValue(Buffer.alloc(MAX_NORMALIZED_BYTES_PER_FILE + 1));
  });

  it("does not re-encode an oversized PNG at an ignored quality", async () => {
    await expect(processImage(Buffer.from("test"), "image/png", { format: "png" })).rejects.toThrow(
      Error
    );
    expect(png).toHaveBeenCalledTimes(1);
    expect(encode).toHaveBeenCalledTimes(1);
  });

  it("stops lossy retries at the minimum quality without repeating it", async () => {
    await expect(
      processImage(Buffer.from("test"), "image/png", { format: "webp", quality: 85 })
    ).rejects.toThrow(Error);
    expect(webp.mock.calls.map(([options]) => options.quality)).toEqual([85, 70, 60]);
    expect(encode).toHaveBeenCalledTimes(3);
  });
});
