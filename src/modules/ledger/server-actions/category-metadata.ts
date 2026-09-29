"use server";

import { parseEntryCategoryId } from "../contract-schemas";
import { withLedgerAccess } from "../access";
import { generateEntryCategoryMetadata } from "../server/category-metadata";

export const generateEntryCategoryMetadataAction = withLedgerAccess(
  async (inputCategoryId: string) =>
    generateEntryCategoryMetadata({ categoryId: parseEntryCategoryId(inputCategoryId) })
);
