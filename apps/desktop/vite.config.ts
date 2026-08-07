import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

const host = process.env.TAURI_DEV_HOST;

// Tauri expects a fixed port and no clearing of the screen.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    target: "es2021",
    sourcemap: true,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          // Keep the OCR engine in its own lazy chunk (never in the startup path).
          if (id.includes("tesseract")) return "ocr";
          // Stable framework vendor split so it caches across app updates.
          // Everything that imports React (including the use-sync-external-store
          // shim that zustand/react-router depend on) MUST stay in this chunk;
          // otherwise it can evaluate before React is defined and crash at
          // startup with "Cannot read properties of undefined (reading
          // 'useState')", leaving a black window.
          if (
            id.includes("react-router") ||
            id.includes("/react-dom/") ||
            id.includes("/react/") ||
            id.includes("/scheduler/") ||
            id.includes("use-sync-external-store")
          ) {
            return "react-vendor";
          }
          if (id.includes("zustand")) return "state-vendor";
          return "vendor";
        },
      },
    },
  },
});
