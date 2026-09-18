import fs from "node:fs";
import vm from "node:vm";
import zlib from "node:zlib";

const manifestPath = ".next/server/app/[locale]/(protected)/page_client-reference-manifest.js";
const routeKey = "/[locale]/(protected)/page";
// The protected route is the app's largest client bundle, so this is a ratchet:
// lower it whenever a change frees weight, and raise it only for work that has
// to ship. The 单账户 + 分账 change is the latter — it adds the book scope chip and
// the archived-book controls to the ledger page, measured at 220_223 gzip bytes
// against the previous budget of 220_000 (HEAD had only 735 bytes of room). The
// raise is kept to the smallest round number that fits, so the next regression
// still trips it.
const maximumGzipBytes = 221_000;

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
  throw new Error(
    `Protected route client footprint exceeded its budget (${gzipBytes} > ${maximumGzipBytes})`
  );
}
