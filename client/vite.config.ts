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
        navigateFallbackDenylist: [/^\/admin/, /^\/api/, /^\/health/],
        importScripts: ["/push-sw.js"],
      },
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "Bluecom Record",
        short_name: "Record",
        description: "의뢰인 음성 업로드 테스트",
        theme_color: "#1e40af",
        background_color: "#f8fafc",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "favicon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
  },
});
