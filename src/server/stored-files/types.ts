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

export interface UploadFileRequestContract {
  contentType: string;
  byteSize: number;
  originalFilename: string | null;
  checksum?: string | null;
}

/**
 * Where the browser sends each file. A target's id is the pending stored
 * file's, which finalization then takes.
 */
export interface DirectUploadPlanContract {
  expiresAt: string;
  targets: readonly {
    id: string;
    url: string;
    requiredHeaders: Readonly<Record<string, string>>;
  }[];
  maxFiles: number;
  maxBytesPerFile: number;
}

export interface AuthorizedFileReadContract {
  file: StoredFileContract;
  body: Uint8Array;
}
