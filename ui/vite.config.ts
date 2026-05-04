import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { createUiDevWatchOptions } from "./src/lib/vite-watch";

//// Neoffice Modification: vite-base-paperclip-prefix
//// Why: Paperclip is served under /paperclip/ behind nginx on Neoffice
////      (osiris.neoffice.me/paperclip/, same-domain coexistence with Frappe ERP).
////      Vite defaults to absolute "/" asset paths, which 404 against Frappe
////      and leave the page black (dark theme without React mounted).
////      Set PAPERCLIP_BASE_URL=/paperclip/ at build time on Neoffice deploys.
////      Default ("/") preserves NeoCompany behaviour on dedicated subdomain.
//// Date: 2026-05-04
//// Refs: cf upstream master commit 4d420c66 (lost on Nora branch fork) ; NORA #26
const base = process.env.PAPERCLIP_BASE_URL || "/";
//// End Neoffice Modification: vite-base-paperclip-prefix

export default defineConfig(({ mode }) => ({
  base,
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
