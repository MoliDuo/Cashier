// SourceDocumentProcessor 类型定义

export interface SourceDocumentInput {
  text?: string;
  images?: Array<{
    data: string; // Base64 或 URL
    mimeType: string; // image/jpeg, image/png, etc.
  }>;
}

export interface ParsedLedgerEntry {
  itemName: string;
  amount: string; // canonical decimal string, e.g. "45.00"
  currency: string | null;
  categoryIndex: number; // 0 = no category, 1+ = index into categories array
  entryDate: string | null; // YYYY-MM-DD 格式
  notes?: string | null; // Consolidated notes
  receiptIndex?: number; // index of receipt within multi-receipt document
  isAdjustment?: boolean; // true for order_adjustments rows (discounts, fees, etc.)
  dateHint?: import("@/modules/source-document/date-organization-contracts").DateHint;
}

export interface CategoryInfo {
  id: string;
  name: string;
  description: string | null;
}

export type SourceType = "text" | "image" | "mixed";

export function determineSourceType(input: SourceDocumentInput): SourceType {
  const hasText = input.text != null && input.text !== "";
  const hasImages = !!(input.images && input.images.length > 0);

  if (hasText && hasImages) return "mixed";
  if (hasImages) return "image";
  return "text";
}
