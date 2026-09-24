import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest, NextResponse } from "next/server";
import { ValidationError } from "@/lib/errors";

const { handleApiV1RouteMock, createSourceDocumentFromCredentialRequestMock } = vi.hoisted(() => ({
  handleApiV1RouteMock: vi.fn(),
  createSourceDocumentFromCredentialRequestMock: vi.fn(),
}));

vi.mock("@/server/api-v1/request-pipeline", () => ({
  handleApiV1Route: handleApiV1RouteMock,
  ApiV1HandlerFailure: class ApiV1HandlerFailure extends Error {
    readonly cause: unknown;
    readonly metrics: unknown;

    constructor(cause: unknown, metrics?: unknown) {
      super("API v1 route handler failed", { cause });
      this.name = "ApiV1HandlerFailure";
      this.cause = cause;
      this.metrics = metrics;
    }
  },
}));

vi.mock("@/modules/source-document/server/create-from-credential-request", () => ({
  createSourceDocumentFromCredentialRequest: createSourceDocumentFromCredentialRequestMock,
}));

import { POST } from "@/app/api/v1/source-documents/route";

describe("api/v1/source-documents omission semantics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handleApiV1RouteMock.mockImplementation(
      async (
        request: NextRequest,
        {
          handler,
        }: {
          handler: (ctx: {
            credential: { id: string; ledgerId: string };
            request: NextRequest;
            requestId: string;
          }) => Promise<{ response: NextResponse; metrics?: unknown }>;
        }
      ) => {
        const result = await handler({
          credential: { id: "cred-1", ledgerId: "ledger-1" },
          request,
          requestId: "request-1",
        });
        return result.response;
      }
    );
    createSourceDocumentFromCredentialRequestMock.mockResolvedValue({
      sourceDocumentId: "doc-1",
      revisionId: "revision-1",
      revisionState: "processing",
    });
  });

  it("omits absent optional fields in POST payload", async () => {
    const request = new Request("http://localhost:3000/api/v1/source-documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        images: [{ data: "AQ==", mimeType: "image/jpeg" }],
      }),
    }) as unknown as NextRequest;

    await POST(request);

    const input = createSourceDocumentFromCredentialRequestMock.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    const payload = input.payload as Record<string, unknown>;
    const images = payload.images as Array<{
      bytes: Uint8Array;
      mimeType: string;
      contentHash: string;
    }>;
    expect(images).toHaveLength(1);
    expect(images[0]?.mimeType).toBe("image/jpeg");
    expect(images[0]?.bytes).toEqual(Buffer.from("AQ==", "base64"));
    expect(images[0]?.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.prototype.hasOwnProperty.call(payload, "entryDate")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(input, "idempotencyKey")).toBe(false);
  });

  it("passes a legal Idempotency-Key through unchanged", async () => {
    const request = new Request("http://localhost:3000/api/v1/source-documents", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "  spaced-but-legal-key  ",
      },
      body: JSON.stringify({
        images: [{ data: "AQ==", mimeType: "image/jpeg" }],
      }),
    }) as unknown as NextRequest;

    await POST(request);

    const input = createSourceDocumentFromCredentialRequestMock.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(input.idempotencyKey).toBe("  spaced-but-legal-key  ");
  });

  it("rejects an invalid Idempotency-Key before consuming the request body", async () => {
    // A body stream that fails as soon as it is pulled: if the route read the
    // body before validating the key, the rejection would surface this error
    // instead of the idempotency validation failure.
    const body = new ReadableStream<Uint8Array>({
      pull() {
        throw new Error("request body was consumed");
      },
    });
    const request = new Request("http://localhost:3000/api/v1/source-documents", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": " ".repeat(513),
      },
      body,
    }) as unknown as NextRequest;

    await expect(POST(request)).rejects.toMatchObject({
      cause: expect.any(ValidationError),
    });

    expect(createSourceDocumentFromCredentialRequestMock).not.toHaveBeenCalled();
  });

  it("returns 201 with the relative Location header", async () => {
    const request = new Request("http://localhost:3000/api/v1/source-documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        images: [{ data: "AQ==", mimeType: "image/jpeg" }],
      }),
    }) as unknown as NextRequest;

    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(response.headers.get("Location")).toBe("/api/v1/source-documents/doc-1");
  });
});
