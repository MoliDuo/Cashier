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

export interface AuthorizedFileReadContract {
  file: StoredFileContract;
  body: Uint8Array;
}
