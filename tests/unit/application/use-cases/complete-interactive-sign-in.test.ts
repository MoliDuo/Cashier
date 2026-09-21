import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LedgerPort, OtpTokenPort } from "@/application/contracts";
import { AUTH_ERROR_CODES, AuthSignInError } from "@/modules/auth/errors";
import type { AuthenticatedPrincipal } from "@/modules/auth/contracts";

const { resolveHomeMock, consumeOTPClaimMock, releaseOTPClaimMock } = vi.hoisted(() => ({
  resolveHomeMock: vi.fn(),
  consumeOTPClaimMock: vi.fn(),
  releaseOTPClaimMock: vi.fn(),
}));

vi.mock("@/modules/workspace/application/use-cases/resolve-home", () => ({
  resolveHome: resolveHomeMock,
}));

vi.mock("@/modules/auth/services/otp-verification", () => ({
  consumeOTPClaim: consumeOTPClaimMock,
  releaseOTPClaim: releaseOTPClaimMock,
}));

import { completeInteractiveSignIn } from "@/application/use-cases/complete-interactive-sign-in";

const ledgers = {} as LedgerPort;
const otpTokens = {} as OtpTokenPort;
const dependencies = { ledgers, otpTokens };
const principal: AuthenticatedPrincipal = {
  id: "user-1",
  email: "user@example.com",
  name: "User",
  image: null,
  locale: "en",
  authVersion: 1,
};
const otpPrincipal: AuthenticatedPrincipal = {
  ...principal,
  pendingOtpClaim: { email: "user@example.com", tokenHash: "v2:hash:salt" },
};

describe("completeInteractiveSignIn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveHomeMock.mockResolvedValue({
      id: "ledger-1",
      settings: {},
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    consumeOTPClaimMock.mockResolvedValue(true);
    releaseOTPClaimMock.mockResolvedValue(true);
  });

  it("verifies the shared ledger before completing sign-in", async () => {
    const result = await completeInteractiveSignIn(principal, dependencies);

    expect(resolveHomeMock).toHaveBeenCalledWith("user-1", ledgers);
    expect(result).toEqual(principal);
    expect(consumeOTPClaimMock).not.toHaveBeenCalled();
  });

  it("does not use locale for ledger lookup", async () => {
    await completeInteractiveSignIn({ ...principal, locale: "" }, dependencies);

    expect(resolveHomeMock).toHaveBeenCalledWith("user-1", ledgers);
  });

  it("consumes the OTP claim only after ledger setup succeeds", async () => {
    const result = await completeInteractiveSignIn(otpPrincipal, dependencies);

    expect(consumeOTPClaimMock).toHaveBeenCalledWith(
      { email: "user@example.com", tokenHash: "v2:hash:salt" },
      otpTokens
    );
    expect(result).toEqual(principal);
    expect(result).not.toHaveProperty("pendingOtpClaim");
  });

  it("releases the OTP claim and propagates ledger setup failures", async () => {
    resolveHomeMock.mockRejectedValueOnce(new Error("ledger unavailable"));

    await expect(completeInteractiveSignIn(otpPrincipal, dependencies)).rejects.toThrow(
      "ledger unavailable"
    );

    expect(releaseOTPClaimMock).toHaveBeenCalledWith(
      { email: "user@example.com", tokenHash: "v2:hash:salt" },
      otpTokens
    );
    expect(consumeOTPClaimMock).not.toHaveBeenCalled();
  });

  it("propagates ledger setup failures without a claim", async () => {
    resolveHomeMock.mockRejectedValueOnce(new Error("ledger unavailable"));

    await expect(completeInteractiveSignIn(principal, dependencies)).rejects.toThrow(
      "ledger unavailable"
    );
    expect(releaseOTPClaimMock).not.toHaveBeenCalled();
  });

  it("fails the sign-in when the OTP claim can no longer be consumed", async () => {
    consumeOTPClaimMock.mockResolvedValue(false);

    let caught: unknown;
    try {
      await completeInteractiveSignIn(otpPrincipal, dependencies);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AuthSignInError);
    expect(caught).toMatchObject({ code: AUTH_ERROR_CODES.OTP_INVALID });
  });

  it("releases the claim when consuming it throws", async () => {
    consumeOTPClaimMock.mockRejectedValueOnce(new Error("consume unavailable"));

    await expect(completeInteractiveSignIn(otpPrincipal, dependencies)).rejects.toThrow(
      "consume unavailable"
    );
    expect(releaseOTPClaimMock).toHaveBeenCalledWith(otpPrincipal.pendingOtpClaim, otpTokens);
  });
});
