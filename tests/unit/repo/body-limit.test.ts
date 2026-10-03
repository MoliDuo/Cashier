import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config";
import { API_V1_MAX_REQUEST_BYTES } from "@/modules/source-document/api-v1-policy";
import { MAX_ORIGINAL_BYTES_PER_FILE } from "@/lib/storage/upload-policy";

describe("request body limit", () => {
  const limit = nextConfig.experimental?.proxyClientMaxBodySize;

  it("is set, since the default silently truncates bodies past 10 MB", () => {
    expect(typeof limit).toBe("number");
  });

  it("covers the largest API v1 request", () => {
    expect(limit).toBeGreaterThanOrEqual(API_V1_MAX_REQUEST_BYTES);
  });

  it("covers the largest web upload with room for its headers", () => {
    expect(limit).toBeGreaterThan(MAX_ORIGINAL_BYTES_PER_FILE);
  });
});
