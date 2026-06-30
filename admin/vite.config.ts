import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { port: 5174 },
  define: {
    __ADMIN_BUILD__: JSON.stringify(process.env.VITE_ADMIN_BUILD || "local"),
  },
});
