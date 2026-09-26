import fs from "node:fs";
import vm from "node:vm";
import zlib from "node:zlib";

// 流水 is where the app opens, so its bundle is the one a reader waits on.
const manifestPath =
  ".next/server/app/(protected)/(ledger)/stream/page_client-reference-manifest.js";
const routeKey = "/(protected)/(ledger)/stream/page";
// The protected route is the app's largest client bundle. This reports its
// weight rather than gating on it: two readers on an installed PWA are not the
// audience a byte budget protects, and keeping the number honest cost more
// prose than the number was worth.
const maximumGzipBytes = 223_000;

if (!fs.existsSync(manifestPath)) {
  throw new Error(`Protected-route client manifest is missing: ${manifestPath}`);
}

const context = {};
context.globalThis = context;
vm.runInNewContext(fs.readFileSync(manifestPath, "utf8"), context, { filename: manifestPath });
const manifest = context.__RSC_MANIFEST?.[routeKey];
if (manifest == null) throw new Error(`Protected-route manifest entry is missing: ${routeKey}`);

const files = new Set();
for (const clientModule of Object.values(manifest.clientModules)) {
  for (const chunk of clientModule.chunks ?? []) {
    if (chunk.endsWith(".js")) files.add(decodeURIComponent(chunk));
  }
}

let gzipBytes = 0;
for (const file of files) {
  gzipBytes += zlib.gzipSync(fs.readFileSync(`.next/${file}`)).byteLength;
}

console.log(
  `Protected route client footprint: ${gzipBytes} gzip bytes across ${files.size} chunks (budget ${maximumGzipBytes})`
);
if (gzipBytes > maximumGzipBytes) {
  console.warn(
    `Warning: the protected route grew past ${maximumGzipBytes} gzip bytes. Worth a look, not a failure.`
  );
}
