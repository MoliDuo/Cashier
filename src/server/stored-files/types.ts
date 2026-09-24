interface TrustedFileMetadata {
  contentType: string;
  byteSize: number;
  originalFilename: string | null;
  checksum: string | null;
}

export interface StoredFileContract {
  id: string;
  metadata: TrustedFileMetadata;
  createdAt: string;
}

/**
 * A slot in an upload session. A server-side upload writes to it through the
 * server, so the id is all it needs; only a plan the browser has to execute
 * itself carries somewhere to send the bytes.
 */
interface UploadTargetContract {
  id: string;
}

interface DirectUploadTargetContract extends UploadTargetContract {
  url: string;
  requiredHeaders: Readonly<Record<string, string>>;
}

export interface UploadFileRequestContract {
  contentType: string;
  byteSize: number;
  originalFilename: string | null;
  checksum?: string | null;
}

export interface UploadPlanContract {
  id: string;
  expiresAt: string;
  targets: readonly UploadTargetContract[];
  finalizationToken: string;
  maxFiles: number;
  maxBytesPerFile: number;
}

/** An upload plan whose targets the caller reaches over the network itself. */
export interface DirectUploadPlanContract extends Omit<UploadPlanContract, "targets"> {
  targets: readonly DirectUploadTargetContract[];
}

export interface UploadFinalizationContract {
  uploadSessionId: string;
  finalizationToken: string;
  targetIds: readonly string[];
  ledgerId: string;
}

export interface AuthorizedFileReadContract {
  file: StoredFileContract;
  body: Uint8Array;
}
