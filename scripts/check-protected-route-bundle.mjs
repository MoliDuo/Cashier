import fs from "node:fs";
import vm from "node:vm";
import zlib from "node:zlib";

const manifestPath = ".next/server/app/[locale]/(protected)/page_client-reference-manifest.js";
const routeKey = "/[locale]/(protected)/page";
// The protected route is the app's largest client bundle, so this is a ratchet:
// lower it whenever a change frees weight, and raise it only for work that has
// to ship. Two changes have been the latter.
//
// 去掉总账默认分账: dropping the ★ / default-book code and the URL scope did not
// pay for the device-memory machinery that replaced them (scope cookie, shared
// scope store, picker localStorage). The route measured 221_160 gzip bytes
// against 220_552 before it, so the budget became the smallest round number that
// covered it.
//
// The page-level assignment run: following a run above the tabs, so its outcome
// reaches the reader even after they switch tabs, costs a provider, its
// completion notice, and the poll's change tracking. It measured 222_174 here
// and 222_366 on Vercel's builder against 220_405 before it, and nothing in it
// is optional — dropping the controller outputs it made redundant did not pay
// for it. The budget is the smallest round number that covers both builders,
// whose measurements differ by about 200 bytes on the same commit.
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
  throw new Error(
    `Protected route client footprint exceeded its budget (${gzipBytes} > ${maximumGzipBytes})`
  );
}
