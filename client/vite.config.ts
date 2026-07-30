import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  define: {
    "import.meta.env.VITE_CLIENT_BUILD_ID": JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      workbox: {
        navigateFallbackDenylist: [/^\/admin/, /^\/api/],
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
        name: "불판녹취",
        short_name: "불판녹취",
        description: "의뢰인 음성 업로드와 녹취 진행",
        lang: "ko",
        theme_color: "#0d1f3c",
        background_color: "#fbfbf9",
        display: "standalone",
        display_override: ["standalone", "browser"],
        orientation: "any",
        start_url: "/",
        scope: "/",
        id: "https://user.bulpen.co.kr/",
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
    port: 5173,
  },
});
