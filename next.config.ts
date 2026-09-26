import type { NextConfig } from "next";

const demoProject = process.env.CASHIER_DEMO_PROJECT;
if (demoProject != null && !/^[a-z][a-z0-9-]{0,40}$/.test(demoProject)) {
  throw new Error("CASHIER_DEMO_PROJECT must be a lowercase Compose project name");
}

// Build remotePatterns from environment
const remotePatterns: Array<{ protocol: "https" | "http"; hostname: string }> = [];

const nextConfig: NextConfig = {
  ...(demoProject == null ? {} : { distDir: `.next-${demoProject}` }),
  // instrumentation.ts is enabled by default in Next.js 16+
  // The dev tools badge is fixed to a viewport corner, where it covers the
  // ledger's own footer controls at phone widths — the source-document modal's
  // Evidence button sits underneath it. Development warnings still reach the
  // terminal and the browser console.
  devIndicators: false,
  images: {
    unoptimized: true, // Disable Next.js image optimization - images are pre-processed on upload
    remotePatterns,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          {
            key: "Permissions-Policy",
            // `self` lets the new-record form open the phone's camera for
            // photographing a receipt; microphone and geolocation stay off.
            value: "camera=(self), microphone=(), geolocation=()",
          },
          {
            key: "Content-Security-Policy",
            // The three directives that need no nonce, so they cost neither a
            // middleware pass nor static optimization. `frame-ancestors` is the
            // one that earns its place: nothing else here refuses to be framed,
            // and a ledger is exactly the kind of page worth clickjacking. The
            // script and style directives are left out on purpose — a useful
            // one needs per-request nonces, and this app has no HTML injection
            // sink to aim them at.
            value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
