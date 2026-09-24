import "server-only";
import crypto from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import OpenAI, { type APIError } from "openai";
import { type ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { runtimeEnv } from "@/lib/env/runtime";
import { AI_MAX_ATTEMPTS, AI_REQUEST_TIMEOUT_MS, AI_RETRY_DELAY_MS } from "@/config/tuning";

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
  private requestTail: Promise<void> = Promise.resolve();
  private cooldownUntil = 0;

  private async withRequestSlot<T>(
    signal: AbortSignal | undefined,
    run: () => Promise<T>
  ): Promise<T> {
    const previous = this.requestTail;
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.requestTail = previous.then(() => held);
    let abort: (() => void) | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        abort = () => reject(new AppError("Request was aborted", "REQUEST_ABORTED"));
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
        previous.then(resolve, reject);
      });
      signal?.throwIfAborted();
      const waitMs = this.cooldownUntil - Date.now();
      if (waitMs > 0) await delay(waitMs, undefined, { signal });
      return await run();
    } finally {
      if (abort != null) signal?.removeEventListener("abort", abort);
      release();
    }
  }

  private retryAfterMs(error: unknown): number {
    if (!isSdkError(error, OpenAI.APIError) || error.status !== 429) return 0;
    const value = (error as APIError).headers?.get("retry-after");
    if (value == null) return 10_000;
    const seconds = Number(value);
    const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
    return Number.isFinite(ms) ? Math.max(0, ms) : 10_000;
  }

  constructor() {
    const apiKey = runtimeEnv.openaiApiKey;
    const baseURL = runtimeEnv.hasOpenaiBaseUrl ? runtimeEnv.openaiBaseUrl : undefined;

    if (apiKey == null || apiKey === "") {
      throw new AppError("OPENAI_API_KEY is not set", "OPENAI_API_KEY_MISSING");
    }

    this.client = new OpenAI({
      apiKey,
      maxRetries: 0,
      timeout: AI_REQUEST_TIMEOUT_MS,
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
    signal?: AbortSignal,
    options?: GenerateContentOptions
  ): Promise<{ content: string; usage?: { promptTokens: number; completionTokens: number } }> {
    const effectiveMaxTokens = maxTokens ?? 8192;
    const effectiveTemperature = temperature ?? 1;
    const maxAttempts = options?.maxAttempts ?? AI_MAX_ATTEMPTS;
    const timeoutMs = options?.timeoutMs ?? AI_REQUEST_TIMEOUT_MS;
    const baseDelay = AI_RETRY_DELAY_MS;
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
        const request: OpenAI.ChatCompletionCreateParamsNonStreaming = {
          model,
          messages: requestMessages,
          max_tokens: effectiveMaxTokens,
          temperature: effectiveTemperature,
        };
        const requestOptions = { ...(signal !== undefined ? { signal } : {}), timeout: timeoutMs };
        const response = await this.withRequestSlot(signal, async () => {
          try {
            return await this.client.chat.completions.create(request, requestOptions);
          } catch (error) {
            this.cooldownUntil = Math.max(
              this.cooldownUntil,
              Date.now() + this.retryAfterMs(error)
            );
            throw error;
          }
        });

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
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
              signal?.removeEventListener("abort", abort);
              resolve();
            }, delay);
            const abort = () => {
              clearTimeout(timer);
              reject(new AppError("Request was aborted", "REQUEST_ABORTED"));
            };
            signal?.addEventListener("abort", abort, { once: true });
            if (signal?.aborted) abort();
          });
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
        throw new AppError("AI provider rate limited after retries", "ai_rate_limited", 503, {
          retryAfterMs: Math.max(0, this.cooldownUntil - Date.now()),
        });
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

export function resetOpenAIClient(): void {
  openAIClient = null;
}
