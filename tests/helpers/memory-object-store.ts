import type { ObjectStore } from "@/lib/storage";

/** In-memory stand-in for the S3 object store; direct-upload methods are opt-in via subclasses. */
export class MemoryObjectStore implements ObjectStore {
  readonly files = new Map<string, Buffer>();

  async upload(key: string, data: Buffer): Promise<string> {
    this.files.set(key, Buffer.from(data));
    return `/private/${key}`;
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

  async presignUpload(
    _key: string,
    _contentType: string,
    _sha256: string,
    _expiresInSeconds: number
  ): ReturnType<ObjectStore["presignUpload"]> {
    throw new Error("Unexpected direct upload in proxy storage fixture");
  }

  async readObject(_key: string): ReturnType<ObjectStore["readObject"]> {
    throw new Error("Unexpected object inspection in proxy storage fixture");
  }

  async delete(key: string): Promise<{ success: boolean; error?: Error }> {
    return { success: this.files.delete(key) };
  }
}
