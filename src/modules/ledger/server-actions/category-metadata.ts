"use server";

import { parseEntryCategoryId } from "../contract-schemas";
import { withLedgerAccess } from "../access";
import { generateEntryCategoryMetadata } from "../server/category-metadata";

export const generateEntryCategoryMetadataAction = withLedgerAccess(
  async (ledgerId: string, inputCategoryId: string) =>
    generateEntryCategoryMetadata({ ledgerId, categoryId: parseEntryCategoryId(inputCategoryId) })
);
