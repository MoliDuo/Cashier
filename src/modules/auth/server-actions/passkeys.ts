"use server";

import crypto from "node:crypto";
import { z } from "zod";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { AUTH_ERROR_CODES } from "@/modules/auth/errors";
import {
  deletePasskey,
  finishPasskeyRegistration,
  renamePasskey,
  startPasskeyRegistration,
} from "@/modules/auth/server/passkeys";
import { PASSKEY_NAME_MAX_LENGTH } from "@/modules/auth/constants";
import type { PasskeySummary } from "@/modules/auth/contracts";
import { requireAuth, requireRecentAuth } from "@/modules/auth/server/session-guards";
import { registrationResponseSchema } from "@/modules/auth/contract-schemas";

export type PasskeyActionErrorCode =
  "reauth_required" | "expired" | "invalid" | "duplicate" | "not_found" | "unexpected";

type Failure = { ok: false; code: PasskeyActionErrorCode };

const nameSchema = z.string().trim().min(1).max(PASSKEY_NAME_MAX_LENGTH);
const idSchema = z.string().min(1).max(1024);

function failure(error: unknown, action: string): Failure {
  if (error instanceof AppError && error.code === AUTH_ERROR_CODES.REAUTHENTICATION_REQUIRED) {
    return { ok: false, code: "reauth_required" };
  }
  if (error instanceof z.ZodError) return { ok: false, code: "invalid" };
  logger.error(
    { correlationId: crypto.randomUUID(), errorCode: "PASSKEY_ACTION_FAILED", action },
    "Passkey action failed"
  );
  return { ok: false, code: "unexpected" };
}

export async function startPasskeyRegistrationAction(): Promise<
  { ok: true; challengeId: string; options: PublicKeyCredentialCreationOptionsJSON } | Failure
> {
  try {
    const userId = await requireRecentAuth();
    return { ok: true, ...(await startPasskeyRegistration(userId)) };
  } catch (error) {
    return failure(error, "start_registration");
  }
}

export async function finishPasskeyRegistrationAction(
  challengeId: string,
  response: RegistrationResponseJSON,
  name: string
): Promise<{ ok: true; passkey: PasskeySummary } | Failure> {
  try {
    const userId = await requireRecentAuth();
    const result = await finishPasskeyRegistration({
      userId,
      challengeId: z.uuid().parse(challengeId),
      response: registrationResponseSchema.parse(response) as RegistrationResponseJSON,
      name: nameSchema.parse(name),
    });
    return result.ok ? result : { ok: false, code: result.reason };
  } catch (error) {
    return failure(error, "finish_registration");
  }
}

export async function renamePasskeyAction(
  id: string,
  name: string
): Promise<{ ok: true } | Failure> {
  try {
    const userId = await requireAuth();
    const renamed = await renamePasskey({
      userId,
      id: idSchema.parse(id),
      name: nameSchema.parse(name),
    });
    return renamed ? { ok: true } : { ok: false, code: "not_found" };
  } catch (error) {
    return failure(error, "rename");
  }
}

export async function deletePasskeyAction(id: string): Promise<{ ok: true } | Failure> {
  try {
    const userId = await requireRecentAuth();
    const deleted = await deletePasskey({ userId, id: idSchema.parse(id) });
    return deleted ? { ok: true } : { ok: false, code: "not_found" };
  } catch (error) {
    return failure(error, "delete");
  }
}
