/**
 * JSON utilities for flow engine
 * Provides JSON validation and extraction for AI responses
 */

/**
 * Check if a string is valid JSON
 */
export function isValidJson(content: string): boolean {
  try {
    JSON.parse(content);
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse JSON string, returns null if invalid
 */
export function tryParseJson<T = unknown>(content: string): T | null {
  try {
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

/**
 * Clean common JSON formatting issues:
 * - Remove markdown code fences
 * - Trim whitespace
 */
export function cleanJsonContent(content: string): string {
  let cleaned = content.trim();

  // Remove markdown code fences
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.slice(0, -3);
  }

  return cleaned.trim();
}

/**
 * Try to extract JSON from response content
 * Handles: markdown fences, surrounding text, embedded JSON
 */
export function extractJson(content: string): string {
  // First try cleaning markdown fences
  const cleaned = cleanJsonContent(content);
  if (cleaned.startsWith("{") || cleaned.startsWith("[")) {
    return cleaned;
  }

  // Try to find JSON object boundaries
  const jsonStart = content.indexOf("{");
  const jsonEnd = content.lastIndexOf("}");

  if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
    return content.substring(jsonStart, jsonEnd + 1);
  }

  // Try array
  const arrStart = content.indexOf("[");
  const arrEnd = content.lastIndexOf("]");

  if (arrStart !== -1 && arrEnd !== -1 && arrEnd > arrStart) {
    return content.substring(arrStart, arrEnd + 1);
  }

  return cleaned;
}

/**
 * Build repair prompt for fixing malformed JSON
 */
export function buildRepairPrompt(originalContent: string): string {
  const hasJson = originalContent.includes("{") || originalContent.includes("[");

  if (!hasJson) {
    return `You are a JSON extraction assistant. The AI model was supposed to return a JSON object but instead returned natural language text. Extract the relevant information from the text below and format it as a valid JSON object.

Rules:
1. Identify what structured data the text is describing
2. Convert it into a proper JSON object
3. Return ONLY the JSON object, no explanations or markdown

Text to convert:
${originalContent}

Return the JSON object now:`;
  }

  return `You are a JSON repair assistant. Fix the malformed JSON content below.

Rules:
1. The input was expected to be valid JSON but has formatting issues
2. Common issues: markdown code blocks, extra text, missing quotes, trailing commas
3. Extract and fix the JSON structure
4. Return ONLY the corrected JSON object, no explanations or markdown

Content to repair:
${originalContent}

Return the corrected JSON now:`;
}
