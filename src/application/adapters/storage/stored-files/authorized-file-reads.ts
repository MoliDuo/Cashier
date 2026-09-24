import type {
  AuthorizedFileReadContract,
  LedgerId,
  StoredFileContract,
  StoredFileId,
} from "@/application/contracts";
import { AppError } from "@/lib/errors";
import { mapStoredFile, type ResolvedStoredFileAdapterDependencies } from "./shared";

export function createAuthorizedFileReadOperations(
  dependencies: Pick<ResolvedStoredFileAdapterDependencies, "authorizedFiles" | "storage">
) {
  const { authorizedFiles, storage } = dependencies;

  async function readAuthorized(
    ledgerId: LedgerId,
    fileId: StoredFileId
  ): Promise<AuthorizedFileReadContract | null> {
    const row = await authorizedFiles.findForLedger(ledgerId, fileId);
    if (row == null) return null;
    if (row.storageProvider !== "s3") {
      throw new AppError(
        `Unsupported stored file provider: ${row.storageProvider}`,
        "UNSUPPORTED_STORAGE_PROVIDER",
        500,
        { provider: row.storageProvider, fileId: row.id }
      );
    }
    const body = await storage.download(row.storageKey);
    return { file: mapStoredFile(row), body: new Uint8Array(body) };
  }

  async function readAuthorizedStreamForUser(
    userId: string,
    fileId: string
  ): Promise<{
    file: StoredFileContract;
    body: ReadableStream<Uint8Array>;
  } | null> {
    const row = await authorizedFiles.findForUser(userId, fileId);
    if (row == null) return null;
    if (row.storageProvider !== "s3") {
      throw new AppError(
        `Unsupported stored file provider: ${row.storageProvider}`,
        "UNSUPPORTED_STORAGE_PROVIDER",
        500,
        { provider: row.storageProvider, fileId: row.id }
      );
    }
    return { file: mapStoredFile(row), body: await storage.stream(row.storageKey) };
  }

  return {
    readAuthorized,
    readAuthorizedStreamForUser,
  };
}
