import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { createUiDevWatchOptions } from "./src/lib/vite-watch";

// Base URL for assets. Defaults to "/" (root path, like app.neocompany.ch).
// Set to "/paperclip/" when Paperclip is served under a sub-path (e.g. Neoffice
// deployment behind nginx that proxies /paperclip/* → Paperclip local_trusted).
const base = process.env.PAPERCLIP_BASE_URL || "/";

// Explicit replacement so Vite inlines the deployment flag even when the
// `.env.production` file is not picked up in some build environments (pnpm
// monorepo + --filter quirks).
const paperclipDeployment = process.env.VITE_PAPERCLIP_DEPLOYMENT || "";

export default defineConfig(({ mode }) => ({
  base,
  define: {
    "import.meta.env.VITE_PAPERCLIP_DEPLOYMENT": JSON.stringify(paperclipDeployment),
  },
  plugins: [react(), tailwindcss()],
  build: {
    minify: "esbuild",
  },
  esbuild:
    mode === "production"
      ? {
          drop: ["console", "debugger"],
          legalComments: "none",
        }
      : undefined,
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      lexical: path.resolve(__dirname, "./node_modules/lexical/Lexical.mjs"),
    },
  },
  server: {
    port: 5173,
    watch: createUiDevWatchOptions(process.cwd()),
    proxy: {
      "/api": {
        target: "http://localhost:3100",
        ws: true,
      },
    },
  },
}));
