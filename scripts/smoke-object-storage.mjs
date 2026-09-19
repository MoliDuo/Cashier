/**
 * The object store the production smoke run writes to.
 *
 * `npm run test:smoke` boots the real production server, so the upload path it
 * exercises — process the image, put it, read it back for the AI, delete it
 * again — cannot be replaced with an in-process fake the way unit tests do it.
 * This is a provider instead: an S3-compatible endpoint that keeps objects in
 * memory for the life of the run, so nothing leaves the machine and no bucket
 * outside this run is read or written.
 *
 * Only the operations the application issues are implemented: PutObject,
 * GetObject, HeadObject, DeleteObject, CopyObject and ListObjectsV2, all with
 * path-style addressing. Requests are not authenticated — the endpoint exists
 * only on loopback and only while the smoke run is up.
 *
 * The store and the request shapes are separate so each can be checked without
 * a socket: the HTTP server below is a thin translation of `createSmokeObjectStore`
 * onto S3's XML, and the smoke run itself is what proves the two agree.
 */

import { createHash } from "node:crypto";
import http from "node:http";

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>';

export function xmlEscape(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** The ETag S3 reports for an object: its MD5, quoted. */
export function etagOf(body) {
  return `"${createHash("md5").update(body).digest("hex")}"`;
}

/** Splits a path-style request target into its bucket and key. */
export function splitPath(pathname) {
  const segments = pathname.replace(/^\/+/, "").split("/");
  const bucket = decodeURIComponent(segments[0] ?? "");
  const key = segments.slice(1).map(decodeURIComponent).join("/");
  return { bucket, key };
}

/** The user metadata a request carries, in the `x-amz-meta-` namespace S3 uses. */
export function collectMetadata(headers) {
  const metadata = {};
  for (const [header, value] of Object.entries(headers)) {
    if (header.startsWith("x-amz-meta-") && typeof value === "string") {
      metadata[header.slice("x-amz-meta-".length)] = value;
    }
  }
  return metadata;
}

function byKey([left], [right]) {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * The objects, with the behavior the client depends on: what a put stores, what
 * a copy copies, and how a listing pages. No HTTP, no XML.
 */
export function createSmokeObjectStore() {
  const objects = new Map();

  return {
    put(key, { body, contentType = "application/octet-stream", metadata = {} }) {
      const object = { body, contentType, metadata, lastModified: new Date() };
      objects.set(key, object);
      return object;
    },
    get(key) {
      return objects.get(key) ?? null;
    },
    /** Copies an existing object's bytes and metadata; `null` when the source is gone. */
    copy(sourceKey, destinationKey) {
      const source = objects.get(sourceKey);
      if (source == null) return null;
      const copied = { ...source, lastModified: new Date() };
      objects.set(destinationKey, copied);
      return copied;
    },
    delete(key) {
      return objects.delete(key);
    },
    /** One page of the keys under `prefix`, in the order S3 returns them. */
    list(prefix = "", maxKeys = 1000) {
      const matching = [...objects.entries()].filter(([key]) => key.startsWith(prefix)).sort(byKey);
      const limit = Number.isFinite(maxKeys) && maxKeys >= 0 ? maxKeys : 1000;
      const entries = matching.slice(0, limit);
      return { entries, keyCount: entries.length, isTruncated: matching.length > entries.length };
    },
    size() {
      return objects.size;
    },
  };
}

/** The ListObjectsV2 envelope the AWS SDK parses. */
export function buildListXml({ prefix, maxKeys, encodingType, entries, keyCount, isTruncated }) {
  const encode = (value) => (encodingType === "url" ? encodeURIComponent(value) : value);
  const contents = entries
    .map(
      ([key, object]) =>
        `<Contents><Key>${xmlEscape(encode(key))}</Key>` +
        `<LastModified>${object.lastModified.toISOString()}</LastModified>` +
        `<ETag>${xmlEscape(etagOf(object.body))}</ETag>` +
        `<Size>${object.body.length}</Size><StorageClass>STANDARD</StorageClass></Contents>`
    )
    .join("");
  return (
    `<ListBucketResult><Name>cashier</Name><Prefix>${xmlEscape(encode(prefix))}</Prefix>` +
    `<KeyCount>${keyCount}</KeyCount><MaxKeys>${maxKeys}</MaxKeys>` +
    `<IsTruncated>${isTruncated}</IsTruncated>` +
    (encodingType == null ? "" : `<EncodingType>${xmlEscape(encodingType)}</EncodingType>`) +
    contents +
    "</ListBucketResult>"
  );
}

/**
 * A running, empty bucket. Listen on the returned server and point
 * `S3_ENDPOINT` at `http://127.0.0.1:<port>`.
 */
export function createSmokeObjectStorage({
  log = () => {},
  store = createSmokeObjectStore(),
} = {}) {
  const sendXml = (response, status, body) => {
    const payload = Buffer.from(`${XML_HEADER}\n${body}`, "utf8");
    response.writeHead(status, {
      "content-type": "application/xml",
      "content-length": String(payload.length),
    });
    response.end(payload);
  };
  const sendError = (response, status, code, message) => {
    sendXml(
      response,
      status,
      `<Error><Code>${xmlEscape(code)}</Code><Message>${xmlEscape(message)}</Message></Error>`
    );
  };
  const readBody = async (request) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    return Buffer.concat(chunks);
  };

  const handlePut = (response, request, key, body) => {
    // A PUT against the bucket itself stands in for bucket creation.
    if (key === "") {
      response.writeHead(200);
      response.end();
      return;
    }
    const copySource = request.headers["x-amz-copy-source"];
    if (typeof copySource === "string") {
      const decoded = decodeURIComponent(copySource);
      const copied = store.copy(
        splitPath(decoded.startsWith("/") ? decoded : `/${decoded}`).key,
        key
      );
      if (copied == null) {
        sendError(response, 404, "NoSuchKey", "The specified key does not exist.");
        return;
      }
      sendXml(
        response,
        200,
        `<CopyObjectResult><ETag>${xmlEscape(etagOf(copied.body))}</ETag>` +
          `<LastModified>${copied.lastModified.toISOString()}</LastModified></CopyObjectResult>`
      );
      return;
    }
    const object = store.put(key, {
      body,
      contentType: request.headers["content-type"] ?? "application/octet-stream",
      metadata: collectMetadata(request.headers),
    });
    response.writeHead(200, { etag: etagOf(object.body) });
    response.end();
  };

  const handleRead = (response, request, key, { headOnly }) => {
    if (key === "") {
      response.writeHead(200);
      response.end();
      return;
    }
    const object = store.get(key);
    if (object == null) {
      // A HEAD has no body to describe a miss in, so the status carries it.
      if (headOnly || request.method === "HEAD") {
        response.writeHead(404);
        response.end();
        return;
      }
      sendError(response, 404, "NoSuchKey", "The specified key does not exist.");
      return;
    }
    const headers = {
      "content-type": object.contentType,
      "content-length": String(object.body.length),
      etag: etagOf(object.body),
      "last-modified": object.lastModified.toUTCString(),
    };
    for (const [name, value] of Object.entries(object.metadata)) {
      headers[`x-amz-meta-${name}`] = value;
    }
    response.writeHead(200, headers);
    if (headOnly || request.method === "HEAD") response.end();
    else response.end(object.body);
  };

  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const { key } = splitPath(url.pathname);
    readBody(request)
      .then((body) => {
        switch (request.method) {
          case "PUT":
            handlePut(response, request, key, body);
            return;
          case "GET":
            if (key === "" && url.searchParams.has("list-type")) {
              const prefix = url.searchParams.get("prefix") ?? "";
              const maxKeys = Number(url.searchParams.get("max-keys") ?? "1000");
              const encodingType = url.searchParams.get("encoding-type");
              sendXml(
                response,
                200,
                buildListXml({
                  prefix,
                  maxKeys,
                  encodingType,
                  ...store.list(prefix, maxKeys),
                })
              );
              return;
            }
            handleRead(response, request, key, { headOnly: false });
            return;
          case "HEAD":
            handleRead(response, request, key, { headOnly: true });
            return;
          case "DELETE":
            store.delete(key);
            response.writeHead(204);
            response.end();
            return;
          default:
            sendError(response, 501, "NotImplemented", `${request.method} is not supported.`);
        }
      })
      .catch((error) => {
        log(`[smoke-storage] ${request.method} ${request.url} failed: ${error.message}`);
        if (!response.writableEnded) {
          sendError(response, 500, "InternalError", "The smoke object store failed.");
        }
      });
  });

  // A client that stops mid-request must not take the whole runner down.
  server.on("clientError", (_error, socket) => {
    if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  });

  return server;
}
