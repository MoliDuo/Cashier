import "./globals.css";
import type { Metadata, Viewport } from "next";
import { metadataCopy } from "@/copy/app";
import { commonCopy } from "@/copy/common";

export const metadata: Metadata = {
  title: metadataCopy.title,
  description: metadataCopy.description,
  manifest: "/manifest.webmanifest",
  icons: {
    icon: ["/favicon.ico", "/icon.png"],
    apple: "/apple-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Cashier",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#101112" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover", // Ensure content extends to edges including notches
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): React.ReactNode {
  // `scroll-behavior: smooth` is set in globals.css; the attribute tells the
  // router it may turn that off for the scroll it performs on navigation, so
  // route changes land where they intend to instead of animating there.
  return (
    <html lang="zh" suppressHydrationWarning data-scroll-behavior="smooth">
      <body className="antialiased" style={{ backgroundColor: "var(--bg)" }}>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[300] focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:text-text focus:shadow-modal"
        >
          {commonCopy.skipToContent}
        </a>
        <main
          id="main-content"
          tabIndex={-1}
          className="max-w-screen-2xl mx-auto min-h-screen pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]"
        >
          {children}
        </main>
      </body>
    </html>
  );
}
