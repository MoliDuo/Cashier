import { describe, expect, it } from "vitest";
import { toApplicationError } from "@/lib/application-errors";
import { AppError, ValidationError } from "@/lib/errors";

describe("toApplicationError", () => {
  it("hides anything that is not an application error behind INTERNAL", () => {
    const error = toApplicationError(new Error("connect ECONNREFUSED 10.0.0.1:5432"));

    expect(error.code).toBe("INTERNAL");
    expect(error.message).not.toContain("10.0.0.1");
    expect(error.correlationId).toBeTypeOf("string");
  });

  it("hides an application error whose code has no public mapping", () => {
    const error = toApplicationError(new AppError("provider said no", "OPENAI_INVALID_RESPONSE"));

    expect(error.code).toBe("INTERNAL");
    expect(error.message).not.toContain("provider");
    expect(error.correlationId).toBeTypeOf("string");
  });

  it("keeps the message of a mapped client error", () => {
    expect(toApplicationError(new ValidationError("Amount is required"))).toEqual({
      code: "VALIDATION_FAILED",
      message: "Amount is required",
    });
  });

  it("maps storage failures to a stable code without the path", () => {
    const error = toApplicationError(
      new AppError("Failed to download /private/uploads/secret.jpg", "S3_DOWNLOAD_FAILED")
    );

    expect(error.code).toBe("STORAGE_UNAVAILABLE");
    expect(error.message).not.toContain("/private");
    expect(error.correlationId).toBeTypeOf("string");
  });
});
