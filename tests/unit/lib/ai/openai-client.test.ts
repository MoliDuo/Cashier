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
      process.env.AI_MAX_RETRIES = "0";
      process.env.AI_RETRY_DELAY_MS = "1";
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
      process.env.AI_MAX_RETRIES = "3";
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
        new OpenAI.APIError(429, { message: "rate limit" }, "Rate limit reached", undefined)
      );

      await expect(
        client.generateContent("system", [{ role: "user", content: "Hello" }], "gpt-4o")
      ).rejects.toMatchObject({
        code: "ai_rate_limited",
      });
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
