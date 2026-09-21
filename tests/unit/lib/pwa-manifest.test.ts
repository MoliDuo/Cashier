import { describe, expect, it } from "vitest";
import { buildPwaManifest } from "@/lib/pwa-manifest";

const expectedIcons = [
  { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
  { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
];

describe("buildPwaManifest", () => {
  it("describes the installed app", () => {
    expect(buildPwaManifest()).toEqual({
      name: "Cashier - AI 记账助手",
      short_name: "Cashier",
      description: "AI 驱动的智能记账工具",
      start_url: "/",
      display: "standalone",
      background_color: "#ffffff",
      theme_color: "#ffffff",
      icons: expectedIcons,
    });
  });
});
