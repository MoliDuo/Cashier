import crypto from "node:crypto";
import type { AIClientFactory, AIContext, AIGenerateOptions, AIResponse } from "./types";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { isValidJson, extractJson, buildRepairPrompt } from "./json-utils";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

interface CreateAIContextOptions {
  signal: AbortSignal;
  getClient: AIClientFactory;
  model: string;
}

/**
 * Create AI context for processing execution
 *
 * Provides AI capabilities with JSON validation/repair and
 * abort signal propagation.
 */
export function createAIContext({ signal, getClient, model }: CreateAIContextOptions): AIContext {
  return {
    async generate(options: AIGenerateOptions): Promise<AIResponse> {
      const correlationId = crypto.randomUUID();
      const startedAt = Date.now();
      const client = getClient();

      // Convert messages to OpenAI format
      // Type assertion needed because OpenAI's ChatCompletionMessageParam is more permissive
      // than our AIMessage type, but we guarantee compatibility through runtime structure
      const messages = options.messages.map((msg) => ({
        role: msg.role,
        content:
          typeof msg.content === "string"
            ? msg.content
            : msg.content.map((part) => {
                if (part.type === "text") {
                  return { type: "text" as const, text: part.text };
                }
                // Safely construct image_url part with proper type assertion
                return {
                  type: "image_url" as const,
                  image_url: { url: part.image_url.url },
                };
              }),
      })) as ChatCompletionMessageParam[];

      if (!model)
        throw new AppError("AI model configuration is required", "AI_MODEL_CONFIG_REQUIRED");

      const maxTokens = options.maxTokens ?? 8192;
      const temperature = options.temperature ?? 1;

      // No response_format: not every model supports it, so JSON is validated
      // and repaired after the response instead.
      // Call OpenAI (signal is passed internally for cancellation)
      const requestSignal =
        options.signal == null ? signal : AbortSignal.any([signal, options.signal]);
      const result = await client.generateContent(
        options.prompt,
        messages,
        model,
        maxTokens,
        temperature,
        requestSignal
      );

      // JSON validation and repair remains private to the processing runtime.
      if (options.requireJson) {
        logger.debug(
          {
            correlationId,
            model,
            durationMs: Date.now() - startedAt,
            contentLength: result.content.length,
            contentHash: crypto
              .createHash("sha256")
              .update(result.content)
              .digest("hex")
              .slice(0, 12),
          },
          "AI raw response (requireJson)"
        );
        const extracted = extractJson(result.content);

        if (isValidJson(extracted) === false) {
          logger.warn(
            {
              correlationId,
              model,
              durationMs: Date.now() - startedAt,
              errorCode: "AI_JSON_INVALID",
              contentLength: result.content.length,
            },
            "AI returned invalid JSON, attempting repair"
          );

          const repairPrompt = buildRepairPrompt(result.content);

          // Internal call to client.generateContent, not through generate()
          // to avoid recursion - this is an internal implementation detail
          const repairResult = await client.generateContent(
            repairPrompt,
            [{ role: "user", content: "Please fix the JSON." }],
            model,
            8192,
            1,
            requestSignal
          );

          const repairedExtracted = extractJson(repairResult.content);

          if (isValidJson(repairedExtracted) === false) {
            logger.error(
              {
                correlationId,
                model,
                durationMs: Date.now() - startedAt,
                errorCode: "AI_JSON_REPAIR_FAILED",
                originalLength: result.content.length,
                repairedLength: repairResult.content.length,
                repairedHash: crypto
                  .createHash("sha256")
                  .update(repairResult.content)
                  .digest("hex")
                  .slice(0, 12),
              },
              "JSON repair failed"
            );
            throw new AppError(
              "AI returned invalid JSON and repair attempt also failed",
              "AI_JSON_REPAIR_FAILED"
            );
          }

          logger.info("JSON repair successful");
          result.content = repairedExtracted;

          // Merge token usage statistics
          if (result.usage && repairResult.usage) {
            result.usage.promptTokens += repairResult.usage.promptTokens;
            result.usage.completionTokens += repairResult.usage.completionTokens;
          }
        } else {
          // Use extracted content (stripped markdown etc.)
          result.content = extracted;
        }
      }

      if (result.usage == null) {
        return {
          content: result.content,
        };
      }

      return {
        content: result.content,
        usage: result.usage,
      };
    },
  };
}
