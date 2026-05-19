import esbuild from "esbuild";
import { createPluginBundlerPresets } from "@paperclipai/plugin-sdk/bundlers";

const presets = createPluginBundlerPresets({ uiEntry: "src/ui/index.tsx" });
const watch = process.argv.includes("--watch");

const workerCtx = await esbuild.context(presets.esbuild.worker);
const manifestCtx = await esbuild.context(presets.esbuild.manifest);
const uiCtx = await esbuild.context(presets.esbuild.ui);

//// Neoffice Modification: wiki-plugin-templates-bundle-fix
//// Why: NORA Sprint I (2026-05-19) — manifest.ts imports './templates.js'
////      (resolved from src/templates.ts → dist/templates.js after build),
////      but the upstream alpha esbuild config only emits worker.js,
////      manifest.js, and ui/. dist/templates.js is missing, so installing
////      the plugin fails with "Cannot find module dist/templates.js".
////      Add a fourth esbuild context bundling src/templates.ts to
////      dist/templates.js with the same Node-ESM preset as manifest, so
////      install_paperclip.sh works without a manual `npx esbuild` step.
//// Date: 2026-05-19
//// Refs: NORA Sprint I POC LLM Wiki, [[swirling-humming-lerdorf]]
const templatesCtx = await esbuild.context({
  ...presets.esbuild.manifest,
  entryPoints: ["src/templates.ts"],
  outfile: "dist/templates.js",
});
//// End Neoffice Modification: wiki-plugin-templates-bundle-fix

if (watch) {
  await Promise.all([workerCtx.watch(), manifestCtx.watch(), uiCtx.watch(), templatesCtx.watch()]);
  console.log("esbuild watch mode enabled for worker, manifest, ui, templates");
} else {
  await Promise.all([workerCtx.rebuild(), manifestCtx.rebuild(), uiCtx.rebuild(), templatesCtx.rebuild()]);
  await Promise.all([workerCtx.dispose(), manifestCtx.dispose(), uiCtx.dispose(), templatesCtx.dispose()]);
}
