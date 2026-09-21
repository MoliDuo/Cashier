import { ValidationError } from "@/lib/errors";
import { isValidUuid } from "@/lib/validation";

export const MAX_BATCH_SIZE = 100;

export function parseBatchIds(input: unknown): string[] {
  if (!Array.isArray(input)) throw new ValidationError("Batch IDs must be an array");
  const ids = [...new Set(input)];
  if (
    ids.length === 0 ||
    ids.length > MAX_BATCH_SIZE ||
    ids.some((id) => typeof id !== "string" || !isValidUuid(id))
  ) {
    throw new ValidationError(`Batch must contain 1-${MAX_BATCH_SIZE} unique UUIDs`);
  }
  return ids as string[];
}
