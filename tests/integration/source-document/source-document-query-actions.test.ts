import { beforeEach, describe, expect, it } from "vitest";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { getSourceDocumentInputAction } from "@/modules/source-document/server-actions/queries";
import { createTestUserWithLedger } from "../../helpers/schema-setup";
import { getTestDb } from "../../setup";

describe("source-document query action boundaries", () => {
  beforeEach(async () => {
    await createTestUserWithLedger(getTestDb());
  });

  it("throws ValidationError when getSourceDocumentInputAction receives an invalid id", async () => {
    await expect(getSourceDocumentInputAction("not-a-uuid")).rejects.toThrow(ValidationError);
  });

  it("preserves NotFoundError from getSourceDocumentInputQuery", async () => {
    await expect(getSourceDocumentInputAction(crypto.randomUUID())).rejects.toThrow(NotFoundError);
  });
});
