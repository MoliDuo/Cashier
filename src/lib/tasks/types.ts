import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

/** Options for the single configured AI model. */
export interface AIGenerateOptions {
  prompt: string; // System prompt
  messages: AIMessage[]; // User messages (can include images)
  maxTokens?: number; // Max output tokens, defaults to 8192
  temperature?: number; // Creativity (0-2), defaults to 1
  requireJson?: boolean; // Require valid JSON response, defaults to false
  signal?: AbortSignal; // Optional stage-local cancellation in addition to the processing signal
}

/**
 * AI message content part
 */
export type AIMessageContentPart =
  { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

/**
 * AI message
 */
interface AIMessage {
  role: "user" | "assistant";
  content: string | AIMessageContentPart[];
}

/**
 * AI generation response
 */
export interface AIResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

/**
 * AI context interface
 */
export interface AIContext {
  generate(options: AIGenerateOptions): Promise<AIResponse>;
}

export interface AIClient {
  generateContent(
    systemPrompt: string,
    messages: ChatCompletionMessageParam[],
    model: string,
    maxTokens?: number,
    temperature?: number,
    signal?: AbortSignal
  ): Promise<AIResponse>;
}

export type AIClientFactory = () => AIClient;
