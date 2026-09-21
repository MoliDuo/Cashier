import type { LedgerPort, OtpTokenPort } from "@/application/contracts";
import { logger } from "@/lib/logger";
import { logIdentifier } from "@/lib/security/log-identifier";
import { AUTH_ERROR_CODES, AuthSignInError } from "@/modules/auth/errors";
import type { AuthenticatedPrincipal } from "@/modules/auth/contracts";
import { consumeOTPClaim, releaseOTPClaim } from "@/modules/auth/services/otp-verification";
import { resolveHome } from "@/modules/workspace/application/use-cases/resolve-home";

/**
 * Complete the cross-domain part of an interactive sign-in.
 *
 * Auth application use cases authenticate an account only. This composition
 * use case is the single place that verifies the shared ledger exists
 * and commits (or releases) a pending OTP claim only after that completes.
 */
export async function completeInteractiveSignIn(
  principal: AuthenticatedPrincipal,
  dependencies: {
    ledgers: Pick<LedgerPort, "getSharedForMember">;
    otpTokens: OtpTokenPort;
  }
): Promise<AuthenticatedPrincipal> {
  const claim = principal.pendingOtpClaim ?? null;
  try {
    await resolveHome(principal.id, dependencies.ledgers);
  } catch (error) {
    if (claim != null) {
      await releaseOTPClaim(claim, dependencies.otpTokens).catch((releaseError) => {
        logger.error(
          { error: releaseError, subject: logIdentifier("email", claim.email) },
          "Failed to release OTP claim after sign-in completion failed"
        );
      });
    }
    throw error;
  }

  if (claim == null) {
    return principal;
  }

  let consumed: boolean;
  try {
    consumed = await consumeOTPClaim(claim, dependencies.otpTokens);
  } catch (error) {
    await releaseOTPClaim(claim, dependencies.otpTokens).catch((releaseError) => {
      logger.error(
        { error: releaseError, subject: logIdentifier("email", claim.email) },
        "Failed to release OTP claim after consume failed"
      );
    });
    throw error;
  }
  if (!consumed) {
    throw new AuthSignInError(AUTH_ERROR_CODES.OTP_INVALID);
  }

  // Never let the transient claim leak into the Auth.js user/JWT payload.
  const { pendingOtpClaim: _pendingOtpClaim, ...completedPrincipal } = principal;
  return completedPrincipal;
}
