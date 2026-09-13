import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

/**
 * AI context contract types for the processing runtime.
 *
 * Business code selects a model tier; the runtime resolves the tier to a
 * concrete model from startup configuration. These types deliberately carry
 * no task-lifecycle concerns: processing intents own their lifecycle.
 */

// ===== AI Integration Types =====

/**
 * AI model tier - business code selects tier, the runtime resolves to concrete model
 * - text: text-only, used for business logic when inputs are text-only
 * - vision: multimodal (vision+text), used whenever a task sends image input
 */
export type AIModelTier = "text" | "vision";

export interface AIModelConfig {
  text: string;
  vision: string;
}

/**
 * Options for AI generation
 */
export interface AIGenerateOptions {
  prompt: string; // System prompt
  messages: AIMessage[]; // User messages (can include images)
  model: AIModelTier; // Required: 'text' or 'vision' tier
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
    responseFormat?:
      | { type: "text" }
      | { type: "json_object" }
      | {
          type: "json_schema";
          json_schema: { name: string; schema: Record<string, unknown>; strict?: boolean };
        },
    signal?: AbortSignal
  ): Promise<AIResponse>;
}

export type AIClientFactory = () => AIClient;
