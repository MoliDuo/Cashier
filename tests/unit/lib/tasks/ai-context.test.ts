import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AIClient } from "@/lib/tasks/types";
import { createAIContext } from "@/lib/tasks/ai-context";

describe("createAIContext", () => {
  let mockSignal: AbortSignal;
  let mockGenerateContent: ReturnType<typeof vi.fn>;
  let mockClient: AIClient;

  const getGenerateContentCall = (index = 0) => {
    const call = mockGenerateContent.mock.calls[index];
    expect(call).toBeDefined();
    if (call == null) {
      throw new Error("Expected generateContent to be called");
    }
    return call;
  };

  beforeEach(() => {
    mockSignal = new AbortController().signal;
    mockGenerateContent = vi.fn().mockResolvedValue({
      content: '{"result": "test"}',
      usage: {
        promptTokens: 100,
        completionTokens: 50,
      },
    });
    mockClient = {
      generateContent: mockGenerateContent as unknown as AIClient["generateContent"],
    };
  });

  const createContext = () =>
    createAIContext({
      signal: mockSignal,
      getClient: () => mockClient,
      model: "test-model",
    });

  it("should return an object with generate method", () => {
    const context = createContext();

    expect(context).toHaveProperty("generate");
    expect(typeof context.generate).toBe("function");
  });

  it("should generate content with basic options", async () => {
    const context = createContext();

    const result = await context.generate({
      prompt: "Test prompt",
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(mockGenerateContent).toHaveBeenCalled();
    expect(result).toHaveProperty("content");
    expect(result).toHaveProperty("usage");
  });

  it("accepts image content with the configured model", async () => {
    const context = createContext();

    await expect(
      context.generate({
        prompt: "Test prompt",
        messages: [
          {
            role: "user",
            content: [
              { type: "image_url" as const, image_url: { url: "http://example.com/image.jpg" } },
            ],
          },
        ],
      })
    ).resolves.toHaveProperty("content");
  });

  it("should throw error when text model config is missing", async () => {
    const context = createAIContext({
      signal: mockSignal,
      getClient: () => mockClient,
      model: "",
    });

    await expect(
      context.generate({
        prompt: "Test prompt",
        messages: [{ role: "user", content: "Hello" }],
      })
    ).rejects.toThrow("AI model configuration is required");
  });

  it("should use default maxTokens and temperature", async () => {
    const context = createContext();

    await context.generate({
      prompt: "Test prompt",
      messages: [{ role: "user", content: "Hello" }],
    });

    const callArgs = getGenerateContentCall();
    expect(callArgs[3]).toBe(8192); // maxTokens default
    expect(callArgs[4]).toBe(1); // temperature default
  });

  it("should accept custom maxTokens and temperature", async () => {
    const context = createContext();

    await context.generate({
      prompt: "Test prompt",
      messages: [{ role: "user", content: "Hello" }],

      maxTokens: 2048,
      temperature: 0.5,
    });

    const callArgs = getGenerateContentCall();
    expect(callArgs[3]).toBe(2048);
    expect(callArgs[4]).toBe(0.5);
  });

  it("should convert string messages to OpenAI format", async () => {
    const context = createContext();

    await context.generate({
      prompt: "Test prompt",
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
      ],
    });

    const callArgs = getGenerateContentCall();
    const messages = callArgs[1];

    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: "user", content: "Hello" });
    expect(messages[1]).toMatchObject({ role: "assistant", content: "Hi there" });
  });

  it("omits usage when the client response does not include token usage", async () => {
    mockGenerateContent.mockResolvedValueOnce({
      content: '{"result": "test"}',
    });

    const context = createContext();

    const result = await context.generate({
      prompt: "Test prompt",
      messages: [{ role: "user", content: "Hello" }],
    });

    expect(Object.hasOwn(result, "usage")).toBe(false);
  });

  it("should handle requireJson option", async () => {
    // Mock for successful JSON extraction
    mockGenerateContent.mockResolvedValue({
      content: '{"result": "test"}',
      usage: { promptTokens: 100, completionTokens: 50 },
    });

    const context = createContext();

    const result = await context.generate({
      prompt: "Test prompt",
      messages: [{ role: "user", content: "Hello" }],

      requireJson: true,
    });

    expect(result.content).toBe('{"result": "test"}');
  });
});
