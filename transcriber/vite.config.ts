import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      workbox: {
        navigateFallbackDenylist: [/^\/api/],
        importScripts: ["/push-sw.js"],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/api/"),
            handler: "NetworkOnly",
          },
        ],
      },
      includeAssets: ["icon-192.png", "icon-512.png", "apple-touch-icon.png", "og-image.png"],
      manifest: {
        name: "불판속기사",
        short_name: "불판속기사",
        description: "속기사 녹취 작업",
        lang: "ko",
        theme_color: "#0f172a",
        background_color: "#0f172a",
        display: "standalone",
        display_override: ["standalone", "browser"],
        orientation: "any",
        start_url: "/",
        scope: "/",
        id: "https://speed-write.netlify.app/",
        categories: ["business", "productivity"],
        icons: [
          {
            src: "icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ],
  server: {
    port: 5175,
  },
  build: {
    sourcemap: false,
    reportCompressedSize: false,
  },
});
