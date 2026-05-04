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

//// Neoffice Modification: neoffice-embed-mode
//// Why: Vite ships .env.production reading + import.meta.env.VITE_* substitution
////      out of the box, but in pnpm-monorepo builds the .env file is sometimes
////      not picked up (envDir quirks, --filter scope, etc.). The result is a
////      bundle with zero occurrences of "neoffice", so the embed branch (cf
////      ui/src/lib/deployment.ts → IS_NEOFFICE) is never reached at runtime.
////      Force the replacement explicitly via Vite's `define` so the inlining
////      happens regardless of how pnpm decided to scope the build.
//// Date: 2026-05-04
//// Refs: cf upstream master commit f0f7f6c7 (lost on Nora branch fork) ; NORA #27 Phase A
const paperclipDeployment = process.env.VITE_PAPERCLIP_DEPLOYMENT || "";
//// End Neoffice Modification: neoffice-embed-mode

export default defineConfig(({ mode }) => ({
  base,
  //// Neoffice Modification: neoffice-embed-mode
  //// Why: see paperclipDeployment block above. The `define` map below performs
  ////      a verbatim string substitution at build time so `IS_NEOFFICE` gates
  ////      survive minification and tree-shaking. Default empty string evaluates
  ////      to falsy → upstream/standalone behaviour preserved.
  //// Refs: NORA #27 Phase A
  define: {
    "import.meta.env.VITE_PAPERCLIP_DEPLOYMENT": JSON.stringify(paperclipDeployment),
  },
  //// End Neoffice Modification: neoffice-embed-mode
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
