import type { MetadataRoute } from "next";
import { THEME_COLOR } from "@/lib/theme-colors";

const icons: MetadataRoute.Manifest["icons"] = [
  { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
  { src: "/icon.png", sizes: "512x512", type: "image/png" },
  { src: "/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
];

export function buildPwaManifest(): MetadataRoute.Manifest {
  return {
    name: "Moli Cashier - AI 记账助手",
    short_name: "Moli Cashier",
    description: "AI 驱动的智能记账工具",
    start_url: "/records",
    display: "standalone",
    background_color: THEME_COLOR.light,
    theme_color: THEME_COLOR.light,
    icons,
  };
}
