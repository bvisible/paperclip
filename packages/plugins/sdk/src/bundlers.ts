/**
 * Bundling presets for Paperclip plugins.
 *
 * These helpers return plain config objects so plugin authors can use them
 * with esbuild or rollup without re-implementing host contract defaults.
 */

export interface PluginBundlerPresetInput {
  pluginRoot?: string;
  manifestEntry?: string;
  workerEntry?: string;
  uiEntry?: string;
  outdir?: string;
  sourcemap?: boolean;
  minify?: boolean;
}

export interface EsbuildLikeOptions {
  entryPoints: string[];
  outdir: string;
  bundle: boolean;
  format: "esm";
  platform: "node" | "browser";
  target: string;
  sourcemap?: boolean;
  minify?: boolean;
  external?: string[];
}

export interface RollupLikeConfig {
  input: string;
  output: {
    dir: string;
    format: "es";
    sourcemap?: boolean;
    entryFileNames?: string;
  };
  external?: string[];
  plugins?: unknown[];
}

export interface PluginBundlerPresets {
  esbuild: {
    worker: EsbuildLikeOptions;
    ui?: EsbuildLikeOptions;
    manifest: EsbuildLikeOptions;
  };
  rollup: {
    worker: RollupLikeConfig;
    ui?: RollupLikeConfig;
    manifest: RollupLikeConfig;
  };
}

/**
 * Build esbuild/rollup baseline configs for plugin worker, manifest, and UI bundles.
 *
 * The presets intentionally externalize host/runtime deps (`react`, SDK packages)
 * to match the Paperclip plugin loader contract.
 */
export function createPluginBundlerPresets(input: PluginBundlerPresetInput = {}): PluginBundlerPresets {
  const uiExternal = [
    "@paperclipai/plugin-sdk/ui",
    "@paperclipai/plugin-sdk/ui/hooks",
    "react",
    "react-dom",
    "react/jsx-runtime",
  ];

  const outdir = input.outdir ?? "dist";
  const workerEntry = input.workerEntry ?? "src/worker.ts";
  const manifestEntry = input.manifestEntry ?? "src/manifest.ts";
  const uiEntry = input.uiEntry;
  const sourcemap = input.sourcemap ?? true;
  const minify = input.minify ?? false;

  //// Neoffice Modification: bundler-worker-externalize-plugin-sdk
  //// Why: NORA Sprint J (2026-05-19) — when @paperclipai/plugin-sdk is bundled
  ////      INTO the worker (default upstream alpha behaviour), esbuild's
  ////      tree-shaker silently strips host-service properties of the ctx
  ////      object returned by buildContext() that aren't referenced
  ////      statically at the immediate call site (setup(ctx), onApiRequest).
  ////      Real-world impact on plugin-llm-wiki v0.1.0: localFolders, skills,
  ////      routines, executionWorkspaces vanish from `ctx` at runtime even
  ////      though they're declared in buildContext(); Object.keys(ctx) returns
  ////      23 keys instead of 27, and `ctx.localFolders.status(...)` throws
  ////      "Cannot read properties of undefined (reading 'status')".
  ////      The manifest preset already externalises the SDK (line ~97 below)
  ////      so it survives tree-shaking. Mirror the same for the worker.
  ////      At runtime the worker resolves @paperclipai/plugin-sdk via the
  ////      plugin's own node_modules (workspace symlink to packages/plugins/sdk).
  //// Date: 2026-05-19
  //// Refs: NORA Sprint J POC LLM Wiki, [[swirling-humming-lerdorf]]
  const esbuildWorker: EsbuildLikeOptions = {
    entryPoints: [workerEntry],
    outdir,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    sourcemap,
    minify,
    external: ["react", "react-dom", "@paperclipai/plugin-sdk"],
  };
  //// End Neoffice Modification: bundler-worker-externalize-plugin-sdk

  const esbuildManifest: EsbuildLikeOptions = {
    entryPoints: [manifestEntry],
    outdir,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    sourcemap,
    external: ["@paperclipai/plugin-sdk"],
  };

  const esbuildUi = uiEntry
    ? {
      entryPoints: [uiEntry],
      outdir: `${outdir}/ui`,
      bundle: true,
      format: "esm" as const,
      platform: "browser" as const,
      target: "es2022",
      sourcemap,
      minify,
      external: uiExternal,
    }
    : undefined;

  //// Neoffice Modification: bundler-worker-externalize-plugin-sdk
  //// Same fix as the esbuild worker preset above — externalise the SDK so its
  //// host-service props survive tree-shaking. Applies symmetrically for the
  //// rollup variant.
  const rollupWorker: RollupLikeConfig = {
    input: workerEntry,
    output: {
      dir: outdir,
      format: "es",
      sourcemap,
      entryFileNames: "worker.js",
    },
    external: ["react", "react-dom", "@paperclipai/plugin-sdk"],
  };
  //// End Neoffice Modification: bundler-worker-externalize-plugin-sdk

  const rollupManifest: RollupLikeConfig = {
    input: manifestEntry,
    output: {
      dir: outdir,
      format: "es",
      sourcemap,
      entryFileNames: "manifest.js",
    },
    external: ["@paperclipai/plugin-sdk"],
  };

  const rollupUi = uiEntry
    ? {
      input: uiEntry,
      output: {
        dir: `${outdir}/ui`,
        format: "es" as const,
        sourcemap,
        entryFileNames: "index.js",
      },
      external: uiExternal,
    }
    : undefined;

  return {
    esbuild: {
      worker: esbuildWorker,
      manifest: esbuildManifest,
      ...(esbuildUi ? { ui: esbuildUi } : {}),
    },
    rollup: {
      worker: rollupWorker,
      manifest: rollupManifest,
      ...(rollupUi ? { ui: rollupUi } : {}),
    },
  };
}
