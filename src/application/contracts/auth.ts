import type {
  AuthenticatedServiceCredentialContract,
  CreatedServiceCredentialContract,
  ServiceCredentialContract,
} from "./ledger";
import type { LedgerId } from "./source-documents";

export interface ServiceCredentialPort {
  authenticate(key: string): Promise<AuthenticatedServiceCredentialContract | null>;
  list(ledgerId: LedgerId): Promise<readonly ServiceCredentialContract[]>;
  create(
    ledgerId: LedgerId,
    name: string,
    bookId: string
  ): Promise<CreatedServiceCredentialContract>;
  /**
   * Rebinds a live key to another book; uploads follow it immediately. Throws
   * `NotFoundError` for a missing key and `ConflictError` for a book outside the
   * ledger, so the result is never null.
   */
  setBook(
    ledgerId: LedgerId,
    credentialId: string,
    bookId: string
  ): Promise<ServiceCredentialContract>;
  revoke(
    ledgerId: LedgerId,
    credentialId: string
  ): Promise<"revoked" | "already_revoked" | "not_found">;
}
