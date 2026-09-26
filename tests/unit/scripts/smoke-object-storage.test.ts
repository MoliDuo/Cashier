import { describe, expect, it } from "vitest";
import {
  buildListXml,
  collectMetadata,
  createSmokeObjectStore,
  etagOf,
  splitPath,
  xmlEscape,
} from "../../../scripts/smoke-object-storage";

/**
 * The smoke run uploads through the real S3 client against this endpoint, so
 * what it stores and the envelope it answers with have to be what that client
 * reads. The transport is exercised by the run itself; here the parts it
 * translates are pinned, because a mistake in any of them shows up only as a
 * failed production smoke run.
 */
const IMAGE = "uploads/ledger/2026/09/19/receipt.png";

function putImage(store: ReturnType<typeof createSmokeObjectStore>, key = IMAGE) {
  return store.put(key, {
    body: Buffer.from("not-really-a-png"),
    contentType: "image/png",
    metadata: { sha256: "abc123" },
  });
}

describe("smoke object store", () => {
  it("keeps the bytes, the type and the metadata a put brought", () => {
    const store = createSmokeObjectStore();
    putImage(store);

    const stored = store.get(IMAGE);

    expect(stored?.body.toString()).toBe("not-really-a-png");
    expect(stored?.contentType).toBe("image/png");
    expect(stored?.metadata).toEqual({ sha256: "abc123" });
    expect(store.get("uploads/missing.png")).toBeNull();
  });

  it("copies the bytes and metadata and leaves the source in place", () => {
    const store = createSmokeObjectStore();
    putImage(store);

    const copy = store.copy(IMAGE, "uploads/ledger/2026/09/19/copy.png");

    expect(copy?.metadata).toEqual({ sha256: "abc123" });
    expect(copy?.lastModified.getTime()).toBeGreaterThanOrEqual(0);
    expect(store.get(IMAGE)).not.toBeNull();
    // A copy whose source is gone is a miss, not an empty object.
    expect(store.copy("uploads/gone.png", "uploads/other.png")).toBeNull();
    expect(store.get("uploads/other.png")).toBeNull();
  });

  it("pages a listing by prefix and drops deleted keys", () => {
    const store = createSmokeObjectStore();
    putImage(store);
    store.put("other/decoy.png", { body: Buffer.from("decoy"), contentType: "image/png" });

    const listed = store.list("uploads/ledger/2026/09/19/", 1000);

    expect(listed.keyCount).toBe(1);
    expect(listed.entries.map(([key]) => key)).toEqual([IMAGE]);
    expect(listed.isTruncated).toBe(false);
    store.put("uploads/ledger/2026/09/19/two.png", { body: Buffer.from("two") });
    const firstPage = store.list("uploads/ledger/2026/09/19/", 1);
    expect(firstPage.entries.map(([key]) => key)).toEqual([IMAGE]);
    expect(firstPage.isTruncated).toBe(true);

    store.delete(IMAGE);
    expect(store.delete(IMAGE)).toBe(false);
    expect(store.size()).toBe(2);
  });
});

describe("smoke object storage request shapes", () => {
  it("reads a path-style target as a bucket and a key", () => {
    expect(splitPath("/smoke-objects/uploads/a%20b.png")).toEqual({
      bucket: "smoke-objects",
      key: "uploads/a b.png",
    });
    expect(splitPath("/smoke-objects")).toEqual({ bucket: "smoke-objects", key: "" });
    expect(splitPath("/smoke-objects/")).toEqual({ bucket: "smoke-objects", key: "" });
  });

  it("separates user metadata from the rest of the request headers", () => {
    expect(
      collectMetadata({
        "content-type": "image/png",
        "x-amz-meta-sha256": "abc123",
        host: "127.0.0.1:1",
      })
    ).toEqual({ sha256: "abc123" });
  });

  it("reports an ETag the way S3 does", () => {
    expect(etagOf(Buffer.from("hi"))).toBe('"49f68a5c8493ec2c0bf489821c21fc3b"');
  });

  it("answers a list with the envelope the SDK parses", () => {
    const store = createSmokeObjectStore();
    putImage(store);
    store.put("other/decoy.png", { body: Buffer.from("decoy"), contentType: "image/png" });

    const xml = buildListXml({
      prefix: "uploads/",
      maxKeys: 1000,
      encodingType: null,
      ...store.list("uploads/", 1000),
    });

    expect(xml).toContain("<KeyCount>1</KeyCount>");
    expect(xml).toContain("<IsTruncated>false</IsTruncated>");
    expect(xml).toContain("<Key>uploads/ledger/2026/09/19/receipt.png</Key>");
    expect(xml).toContain(`<Size>${Buffer.byteLength("not-really-a-png")}</Size>`);
    expect(xml).not.toContain("other/decoy.png");
    // The ETag is quoted inside the document, so it is XML-escaped on the way out.
    const stored = store.get("uploads/ledger/2026/09/19/receipt.png")!;
    expect(xml).toContain(`<ETag>${xmlEscape(etagOf(stored.body))}</ETag>`);
    expect(xmlEscape("a&b<c>")).toBe("a&amp;b&lt;c&gt;");
  });

  it("URL-encodes keys when the client asks for it", () => {
    const store = createSmokeObjectStore();
    store.put("uploads/审 a.png", { body: Buffer.from("x") });

    const xml = buildListXml({
      prefix: "uploads/",
      maxKeys: 1000,
      encodingType: "url",
      ...store.list("uploads/", 1000),
    });

    expect(xml).toContain("<EncodingType>url</EncodingType>");
    expect(xml).toContain(`<Key>${encodeURIComponent("uploads/审 a.png")}</Key>`);
  });
});
