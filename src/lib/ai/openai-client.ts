import "server-only";
import crypto from "node:crypto";
import OpenAI from "openai";
import { type ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { runtimeEnv } from "@/lib/env/runtime";

export interface GenerateContentOptions {
  maxAttempts?: number;
  timeoutMs?: number;
}

function isSdkError<T extends Error>(
  error: unknown,
  constructor: (abstract new (...args: never[]) => T) | undefined
): error is T {
  return typeof constructor === "function" && error instanceof constructor;
}

export class OpenAIClient {
  private client: OpenAI;

  constructor() {
    const apiKey = runtimeEnv.openaiApiKey;
    const baseURL = runtimeEnv.hasOpenaiBaseUrl ? runtimeEnv.openaiBaseUrl : undefined;

    if (apiKey == null || apiKey === "") {
      throw new AppError("OPENAI_API_KEY is not set", "OPENAI_API_KEY_MISSING");
    }

    this.client = new OpenAI({
      apiKey,
      maxRetries: 0,
      timeout: runtimeEnv.aiRequestTimeoutMs,
      dangerouslyAllowBrowser: process.env.NODE_ENV === "test", // Only enable in test environment
      ...(baseURL != null && baseURL !== "" ? { baseURL } : {}),
    });
  }

  async generateContent(
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
    signal?: AbortSignal,
    options?: GenerateContentOptions
  ): Promise<{ content: string; usage?: { promptTokens: number; completionTokens: number } }> {
    const effectiveMaxTokens = maxTokens ?? 8192;
    const effectiveTemperature = temperature ?? 1;
    const maxAttempts = options?.maxAttempts ?? Math.min(runtimeEnv.aiMaxRetries + 1, 3);
    const timeoutMs = options?.timeoutMs ?? runtimeEnv.aiRequestTimeoutMs;
    const baseDelay = runtimeEnv.aiRetryDelayMs;
    const correlationId = crypto.randomUUID();
    const serializedMessages = JSON.stringify(messages);
    const inputHash = crypto
      .createHash("sha256")
      .update(systemPrompt)
      .update(serializedMessages)
      .digest("hex")
      .slice(0, 12);
    const startedAt = Date.now();

    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Check if aborted before each attempt
      if (signal?.aborted) {
        throw new AppError("Request was aborted", "REQUEST_ABORTED");
      }

      try {
        const requestMessages: ChatCompletionMessageParam[] = [
          { role: "system", content: systemPrompt },
          ...messages,
        ];
        const requestBase = {
          model,
          messages: requestMessages,
          max_tokens: effectiveMaxTokens,
          temperature: effectiveTemperature,
        };
        let request: OpenAI.ChatCompletionCreateParamsNonStreaming = requestBase;
        if (responseFormat != null) {
          request = {
            ...requestBase,
            response_format: responseFormat as Exclude<
              OpenAI.ChatCompletionCreateParams["response_format"],
              undefined
            >,
          };
        }
        const requestOptions = { ...(signal !== undefined ? { signal } : {}), timeout: timeoutMs };
        const response = await this.client.chat.completions.create(request, requestOptions);

        if (
          response.choices == null ||
          !Array.isArray(response.choices) ||
          response.choices.length === 0
        ) {
          logger.error(
            {
              correlationId,
              inputHash,
              inputLength: systemPrompt.length + serializedMessages.length,
              model,
              durationMs: Date.now() - startedAt,
              errorCode: "OPENAI_INVALID_RESPONSE",
            },
            "OpenAI response missing choices"
          );
          throw new AppError("Invalid OpenAI response: missing choices", "OPENAI_INVALID_RESPONSE");
        }

        const choice = response.choices[0];
        const content = choice?.message?.content ?? "";

        // Handle empty response with specific finish reasons
        if (content === "" && choice?.finish_reason != null) {
          if (choice.finish_reason === "content_filter") {
            throw new AppError(
              "Content was filtered by OpenAI safety systems. The image may contain content that cannot be processed.",
              "OPENAI_CONTENT_FILTERED"
            );
          } else if (choice.finish_reason === "length") {
            throw new AppError(
              "Input too large: The images consume too many tokens, leaving no space for output. Try with fewer or smaller images.",
              "OPENAI_INPUT_TOO_LARGE"
            );
          }
        }

        // Extract token usage from OpenAI response
        if (response.usage == null) {
          return { content };
        }

        return {
          content,
          usage: {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
          },
        };
      } catch (error) {
        lastError = error;

        // Don't retry if aborted
        if (signal?.aborted) {
          break;
        }

        // Determine if the error is retryable
        let isRetryable = !(
          error instanceof AppError &&
          (error.code === "OPENAI_CONTENT_FILTERED" || error.code === "OPENAI_INPUT_TOO_LARGE")
        );

        // If it's an OpenAI APIError, check the status code
        if (isSdkError(error, OpenAI.APIError) && error.status != null) {
          // 4xx errors are generally NOT retryable, except for 429 (Rate Limit)
          if (error.status >= 400 && error.status < 500 && error.status !== 429) {
            isRetryable = false;
          }
        }

        if (attempt + 1 < maxAttempts && isRetryable) {
          const delay = Math.random() * Math.min(5000, baseDelay * Math.pow(2, attempt));
          logger.warn(
            {
              correlationId,
              inputHash,
              model,
              durationMs: Date.now() - startedAt,
              errorCode: isSdkError(error, OpenAI.APIError)
                ? `OPENAI_${error.status ?? "API_ERROR"}`
                : "OPENAI_REQUEST_FAILED",
              attempt: attempt + 1,
              maxAttempts,
              delayMs: Math.round(delay),
            },
            "OpenAI request failed, retrying"
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        // If we're out of retries or it's not retryable, break loop
        break;
      }
    }

    // Classify exhausted retries into typed application errors so callers can
    // branch on stable codes instead of provider-specific error shapes or
    // message text. Non-retryable 4xx errors are rethrown unchanged.
    if (isSdkError(lastError, OpenAI.APIError)) {
      if (lastError.status === 429) {
        throw new AppError("AI provider rate limited after retries", "ai_rate_limited", 503);
      }
      if (lastError.status != null && lastError.status >= 500) {
        throw new AppError("AI provider unavailable after retries", "ai_provider_unavailable", 503);
      }
      if (lastError.status === 401 || lastError.status === 403 || lastError.status === 404) {
        throw new AppError("AI provider configuration is invalid", "ai_configuration_invalid", 500);
      }
    }

    if (isSdkError(lastError, OpenAI.APIConnectionTimeoutError)) {
      throw new AppError("AI request timed out", "ai_timeout", 504);
    }

    throw lastError;
  }
}

// Singleton instance
let openAIClient: OpenAIClient | null = null;

export function getOpenAIClient(): OpenAIClient {
  if (!openAIClient) {
    openAIClient = new OpenAIClient();
  }
  return openAIClient;
}

/** @testOnly Resets the process cache between provider configuration tests. */
export function resetOpenAIClient(): void {
  openAIClient = null;
}
