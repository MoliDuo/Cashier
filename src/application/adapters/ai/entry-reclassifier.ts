import { getOpenAIClient } from "@/lib/ai/openai-client";
import { runtimeEnv } from "@/lib/env/runtime";
import { AppError } from "@/lib/errors";
import { extractJson } from "@/lib/tasks/json-utils";
import {
  buildReclassificationPrompt,
  buildReclassificationSubjectsMessage,
  reclassificationResponseSchema,
  resolveReclassificationDecisions,
} from "@/modules/ledger/application/reclassification-protocol";
import type { EntryReclassifierPort } from "@/modules/ledger/application/ports";

const MAX_TOKENS = 2000;
/** Batch assignment is a judgement call, not a creative one. */
const TEMPERATURE = 0.1;

export const entryReclassifierAdapter: EntryReclassifierPort = {
  async decide(input) {
    const prompt = buildReclassificationPrompt({
      candidates: input.candidates,
      ...(input.customPrompt == null ? {} : { customPrompt: input.customPrompt }),
    });
    const result = await getOpenAIClient().generateContent(
      prompt,
      [
        {
          role: "user",
          content: buildReclassificationSubjectsMessage({ subjects: input.subjects }),
        },
      ],
      runtimeEnv.aiModel,
      MAX_TOKENS,
      TEMPERATURE
    );

    try {
      const response = reclassificationResponseSchema.parse(
        JSON.parse(extractJson(result.content))
      );
      return resolveReclassificationDecisions({
        subjects: input.subjects,
        candidates: input.candidates,
        response,
      });
    } catch (error) {
      throw new AppError(
        "AI category reclassification response was invalid",
        "AI_JSON_REPAIR_FAILED",
        502,
        {
          cause: error instanceof Error ? error.name : "UnknownError",
        }
      );
    }
  },
};
