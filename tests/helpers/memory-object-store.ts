import type { ListObjectsPage, ObjectStore } from "@/lib/storage";

/** In-memory stand-in for the S3 object store. */
export class MemoryObjectStore implements ObjectStore {
  readonly files = new Map<string, Buffer>();
  /** When each object was last written; a test backdates one to age it. */
  readonly modifiedAt = new Map<string, Date>();

  async upload(key: string, data: Buffer): Promise<string> {
    this.files.set(key, Buffer.from(data));
    this.modifiedAt.set(key, new Date());
    return `/private/${key}`;
  }

  async listObjectsPage(prefix: string): Promise<ListObjectsPage> {
    return {
      objects: [...this.files.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, bytes]) => ({
          key,
          byteSize: bytes.length,
          lastModified: this.modifiedAt.get(key) ?? null,
        })),
      isTruncated: false,
      nextContinuationToken: null,
    };
  }

  async download(key: string): Promise<Buffer> {
    const data = this.files.get(key);
    if (data == null) throw new Error("missing file");
    return Buffer.from(data);
  }

  async stream(key: string): Promise<ReadableStream<Uint8Array>> {
    const bytes = await this.download(key);
    return new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(bytes));
        controller.close();
      },
    });
  }

  async delete(key: string): Promise<{ success: boolean; error?: Error }> {
    this.modifiedAt.delete(key);
    return { success: this.files.delete(key) };
  }
}
