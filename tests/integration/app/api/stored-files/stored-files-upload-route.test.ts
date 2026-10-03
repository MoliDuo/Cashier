import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import sharp from "sharp";
import { getTestDb } from "tests/setup";
import { createTestLedger } from "tests/helpers/schema-setup";
import { MemoryObjectStore } from "tests/helpers/memory-object-store";
import { getCurrentSession } from "@/modules/auth/server/current-session";
import { MAX_ORIGINAL_BYTES_PER_FILE } from "@/lib/storage/upload-policy";
import { storedFiles } from "@/persistence";

const storage = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock("@/lib/storage/s3", () => ({ getS3Storage: () => storage.current }));

import { POST } from "@/app/api/stored-files/route";

async function jpeg(): Promise<Buffer> {
  return sharp({ create: { width: 8, height: 8, channels: 3, background: "white" } })
    .jpeg()
    .toBuffer();
}

function upload(
  body: BodyInit | null,
  headers: Record<string, string> = { "content-type": "image/jpeg" }
): NextRequest {
  return new Request("http://localhost/api/stored-files", {
    method: "POST",
    headers,
    body,
  }) as NextRequest;
}

describe("POST /api/stored-files", () => {
  let objects: MemoryObjectStore;

  beforeEach(async () => {
    await createTestLedger(getTestDb());
    objects = new MemoryObjectStore();
    storage.current = objects;
  });

  it("stores the image and answers with the stored file", async () => {
    const response = await POST(
      upload(new Uint8Array(await jpeg()), {
        "content-type": "image/jpeg",
        "x-filename": encodeURIComponent("午餐 receipt.jpg"),
      })
    );

    expect(response.status).toBe(201);
    const file = await response.json();
    expect(file).toMatchObject({
      id: expect.any(String),
      metadata: { originalFilename: "午餐 receipt.jpg" },
    });
    expect(JSON.stringify(file)).not.toContain("stored/");
    expect(objects.files.has(`stored/${file.id}`)).toBe(true);
  });

  it("refuses a request without a signed-in session", async () => {
    vi.mocked(getCurrentSession).mockResolvedValueOnce(null);

    const response = await POST(upload(new Uint8Array(await jpeg())));

    expect(response.status).toBe(401);
    expect(await getTestDb().select().from(storedFiles)).toHaveLength(0);
  });

  it("refuses a declared length over the limit without reading the body", async () => {
    const response = await POST(
      upload(null, {
        "content-type": "image/jpeg",
        "content-length": String(MAX_ORIGINAL_BYTES_PER_FILE + 1),
      })
    );

    expect(response.status).toBe(413);
  });

  it("refuses a body that grows past the limit however it was declared", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent > MAX_ORIGINAL_BYTES_PER_FILE) return controller.close();
        sent += chunk.length;
        controller.enqueue(chunk);
      },
    });
    const request = new Request("http://localhost/api/stored-files", {
      method: "POST",
      headers: { "content-type": "image/jpeg" },
      body,
      duplex: "half",
    } as RequestInit) as NextRequest;

    const response = await POST(request);

    expect(response.status).toBe(413);
    expect(await getTestDb().select().from(storedFiles)).toHaveLength(0);
  });

  it.each([
    ["an unsupported content type", { "content-type": "application/pdf" }],
    ["no content type", {}],
  ])("refuses %s", async (_name, headers) => {
    const response = await POST(upload(new Uint8Array(await jpeg()), headers));

    expect(response.status).toBe(400);
    expect(objects.files.size).toBe(0);
  });

  it("refuses an empty body", async () => {
    const response = await POST(upload(new Uint8Array(0)));

    expect(response.status).toBe(400);
  });

  it("refuses bytes that are not an image", async () => {
    const response = await POST(upload(new TextEncoder().encode("not an image")));

    expect(response.status).toBe(400);
    expect(await getTestDb().select().from(storedFiles)).toHaveLength(0);
    expect(objects.files.size).toBe(0);
  });

  it("does not echo internal detail when storage fails", async () => {
    objects.upload = async () => {
      throw new Error("secret endpoint down");
    };

    const response = await POST(upload(new Uint8Array(await jpeg())));

    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("secret endpoint");
    expect(await getTestDb().select().from(storedFiles)).toHaveLength(0);
  });
});
