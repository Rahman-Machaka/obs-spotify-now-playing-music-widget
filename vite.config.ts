import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        dashboard: resolve(__dirname, "dashboard.html"),
        widget: resolve(__dirname, "widget.html"),
        bootstrap: resolve(__dirname, "obs-bootstrap.html")
      }
    }
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:3847",
      "/ws": { target: "ws://127.0.0.1:3847", ws: true }
    }
  }
});
