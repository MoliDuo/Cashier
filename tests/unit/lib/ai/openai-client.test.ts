import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("openai-client", () => {
  const originalEnv = process.env.NODE_ENV;
  const originalApiKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    vi.resetModules();
    process.env.OPENAI_API_KEY = "test-api-key";
  });

  afterEach(() => {
    (process.env as Record<string, string>).NODE_ENV = originalEnv ?? "test";
    process.env.OPENAI_API_KEY = originalApiKey;
  });

  it("should allow client creation in test environment", async () => {
    (process.env as Record<string, string>).NODE_ENV = "test";
    const { getOpenAIClient, resetOpenAIClient } = await import("@/lib/ai/openai-client");
    resetOpenAIClient();
    // Should not throw in test environment
    expect(() => getOpenAIClient()).not.toThrow();
  });

  it("should block client creation in production environment", async () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    const { getOpenAIClient, resetOpenAIClient } = await import("@/lib/ai/openai-client");
    resetOpenAIClient();
    // Should throw error about browser environment
    expect(() => getOpenAIClient()).toThrow("browser");
  });

  it("should block client creation in development environment", async () => {
    (process.env as Record<string, string>).NODE_ENV = "development";
    const { getOpenAIClient, resetOpenAIClient } = await import("@/lib/ai/openai-client");
    resetOpenAIClient();
    // Should throw error about browser environment
    expect(() => getOpenAIClient()).toThrow("browser");
  });

  describe("error classification after retry exhaustion", () => {
    beforeEach(() => {
      (process.env as Record<string, string>).NODE_ENV = "test";
    });

    const loadClient = async () => {
      const { getOpenAIClient, resetOpenAIClient } = await import("@/lib/ai/openai-client");
      resetOpenAIClient();
      return getOpenAIClient();
    };

    const stubSdkCreate = (client: unknown, error: unknown) => {
      const sdkClient = client as unknown as {
        client: { chat: { completions: { create: unknown } } };
      };
      sdkClient.client.chat.completions.create = vi.fn().mockRejectedValue(error);
    };

    it.each([
      ["content_filter", "OPENAI_CONTENT_FILTERED"],
      ["length", "OPENAI_INPUT_TOO_LARGE"],
    ])("does not retry deterministic %s responses", async (reason, code) => {
      const client = await loadClient();
      const create = vi.fn().mockResolvedValue({
        choices: [{ finish_reason: reason, message: { content: "" } }],
      });
      const sdkClient = client as unknown as {
        client: { chat: { completions: { create: unknown } } };
      };
      sdkClient.client.chat.completions.create = create;
      await expect(
        client.generateContent("system", [{ role: "user", content: "test" }], "gpt-4o")
      ).rejects.toMatchObject({ code });
      expect(create).toHaveBeenCalledTimes(1);
    });

    it("maps exhausted rate-limit retries to ai_rate_limited", async () => {
      const { OpenAI } = await import("openai");
      const client = await loadClient();
      stubSdkCreate(
        client,
        new OpenAI.APIError(
          429,
          { message: "rate limit" },
          "Rate limit reached",
          new Headers({ "retry-after": "0" })
        )
      );

      await expect(
        client.generateContent("system", [{ role: "user", content: "Hello" }], "gpt-4o")
      ).rejects.toMatchObject({
        code: "ai_rate_limited",
      });
    });

    it("preserves Retry-After for durable retries without a nested retry", async () => {
      const { OpenAI } = await import("openai");
      const client = await loadClient();
      stubSdkCreate(
        client,
        new OpenAI.APIError(429, {}, "Rate limited", new Headers({ "retry-after": "120" }))
      );
      await expect(
        client.generateContent("system", [], "model", undefined, undefined, undefined, undefined, {
          maxAttempts: 1,
        })
      ).rejects.toMatchObject({
        code: "ai_rate_limited",
        details: { retryAfterMs: expect.any(Number) },
      });
      expect(
        (client as unknown as { cooldownUntil: number }).cooldownUntil - Date.now()
      ).toBeGreaterThan(119_000);
    });

    it("serializes requests and cancels a queued request without opening another slot", async () => {
      const client = await loadClient();
      let finish!: (value: unknown) => void;
      const response = { choices: [{ message: { content: "ok" } }] };
      const create = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finish = resolve;
            })
        )
        .mockResolvedValue(response);
      (
        client as unknown as { client: { chat: { completions: { create: unknown } } } }
      ).client.chat.completions.create = create;
      const first = client.generateContent("first", [], "model");
      await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
      const abort = new AbortController();
      const cancelled = client.generateContent(
        "cancelled",
        [],
        "model",
        undefined,
        undefined,
        undefined,
        abort.signal
      );
      const rejection = expect(cancelled).rejects.toMatchObject({ code: "REQUEST_ABORTED" });
      abort.abort();
      await rejection;
      const third = client.generateContent("third", [], "model");
      await Promise.resolve();
      expect(create).toHaveBeenCalledTimes(1);
      finish(response);
      await expect(first).resolves.toMatchObject({ content: "ok" });
      await expect(third).resolves.toMatchObject({ content: "ok" });
      expect(create).toHaveBeenCalledTimes(2);
    });

    it("delays the next caller until the provider cooldown expires", async () => {
      const { OpenAI } = await import("openai");
      const client = await loadClient();
      let limitedAt = 0;
      let resumedAt = 0;
      const create = vi
        .fn()
        .mockImplementationOnce(async () => {
          limitedAt = Date.now();
          throw new OpenAI.APIError(
            429,
            {},
            "Rate limited",
            new Headers({ "retry-after": "0.08" })
          );
        })
        .mockImplementationOnce(async () => {
          resumedAt = Date.now();
          return { choices: [{ message: { content: "ok" } }] };
        });
      (
        client as unknown as { client: { chat: { completions: { create: unknown } } } }
      ).client.chat.completions.create = create;
      await expect(
        client.generateContent("first", [], "model", undefined, undefined, undefined, undefined, {
          maxAttempts: 1,
        })
      ).rejects.toMatchObject({ code: "ai_rate_limited" });
      await expect(client.generateContent("second", [], "model")).resolves.toMatchObject({
        content: "ok",
      });
      expect(resumedAt - limitedAt).toBeGreaterThanOrEqual(75);
    });

    it("maps exhausted 5xx retries to ai_provider_unavailable", async () => {
      const { OpenAI } = await import("openai");
      const client = await loadClient();
      stubSdkCreate(
        client,
        new OpenAI.APIError(503, { message: "overloaded" }, "Service unavailable", undefined)
      );

      await expect(
        client.generateContent("system", [{ role: "user", content: "Hello" }], "gpt-4o")
      ).rejects.toMatchObject({
        code: "ai_provider_unavailable",
      });
    });

    it("maps authentication failures to a stable configuration error", async () => {
      const { OpenAI } = await import("openai");
      const client = await loadClient();
      const apiError = new OpenAI.APIError(
        401,
        { message: "invalid key" },
        "Invalid key",
        undefined
      );
      stubSdkCreate(client, apiError);

      await expect(
        client.generateContent("system", [{ role: "user", content: "Hello" }], "gpt-4o")
      ).rejects.toMatchObject({ code: "ai_configuration_invalid" });
    });
  });
});
