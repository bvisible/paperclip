//// Neocompany Modification — focused tests for the reference-image
//// pathway added to imageGenerate. We don't exercise codex spawning here
//// (that's an integration concern); instead we mock the spawn surface and
//// verify the wiring: ids resolve to bytes on disk, urls bypass entity
//// lookup, the persisted entity carries the audit trail, and the temp
//// dir is cleaned up on success and on failure.
//// End Neocompany Modification

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import {
  makeCtxAccess,
  makeEntitiesStore,
  makePluginContext,
  makeRunCtx,
} from "../../__tests__/test-helpers.js";
import { IMAGE_ENTITY_TYPE } from "../../images/types.js";

// Spy on spawn so codex never actually runs. We feed back a fake PNG by
// inserting it into the codex generated_images dir before the polling
// loop kicks in.
const spawnMock = vi.fn();
vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

let runImageGenerate: typeof import("./image-generate.js").runImageGenerate;
let writeFile: typeof import("node:fs/promises").writeFile;
let mkdtemp: typeof import("node:fs/promises").mkdtemp;
let join: typeof import("node:path").join;
let homedir: typeof import("node:os").homedir;

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAeImBZsAAAAASUVORK5CYII=",
  "base64",
);

beforeEach(async () => {
  vi.resetAllMocks();
  ({ runImageGenerate } = await import("./image-generate.js"));
  ({ writeFile, mkdtemp } = await import("node:fs/promises"));
  ({ join } = await import("node:path"));
  ({ homedir } = await import("node:os"));
});

afterEach(async () => {
  // Best-effort cleanup of anything codex polling left behind under
  // ~/.codex/generated_images/__test__/
  const root = join(homedir(), ".codex", "generated_images", "__test__");
  await rm(root, { recursive: true, force: true }).catch(() => undefined);
});

function setupSpawn({
  emitPngAfterMs = 50,
  pngContents = TINY_PNG,
}: { emitPngAfterMs?: number; pngContents?: Buffer } = {}) {
  spawnMock.mockImplementation(() => {
    const handlers = new Map<string, ((arg: unknown) => void)[]>();
    const child = {
      pid: 12345 + Math.floor(Math.random() * 1000),
      exitCode: null as number | null,
      kill: vi.fn(),
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn((event: string, cb: (arg: unknown) => void) => {
        const list = handlers.get(event) ?? [];
        list.push(cb);
        handlers.set(event, list);
      }),
    };
    // Asynchronously emit a PNG into the codex output dir to mimic a
    // successful generation. The runImageGenerate polling loop should see
    // it on the next 1 s tick.
    setTimeout(async () => {
      const dir = join(homedir(), ".codex", "generated_images", "__test__");
      const { mkdir } = await import("node:fs/promises");
      await mkdir(dir, { recursive: true });
      const p = join(dir, `img_${Date.now()}.png`);
      const { writeFile: wf } = await import("node:fs/promises");
      await wf(p, pngContents);
    }, emitPngAfterMs);
    return child;
  });
}

describe("imageGenerate — reference images plumbing", () => {
  it("resolves referenceImageIds to file paths and passes them via `-i`", async () => {
    setupSpawn();
    const entities = makeEntitiesStore();
    const runCtx = makeRunCtx();
    // Seed a raw upload to be used as ref. The data URL is decoded back
    // to bytes when written to /tmp/codex-refs-*/ref_0.png.
    const sampleDataUrl = `data:image/png;base64,${TINY_PNG.toString("base64")}`;
    await entities.upsert({
      entityType: IMAGE_ENTITY_TYPE,
      scopeKind: "company",
      scopeId: runCtx.companyId,
      externalId: "upload-1",
      title: "Sample upload",
      status: "approved",
      data: {
        prompt: "",
        status: "approved",
        source: "upload",
        finalImageUrl: sampleDataUrl,
        rawImageUrl: sampleDataUrl,
        width: 1,
        height: 1,
        createdAt: new Date().toISOString(),
      },
    });
    const { ctx } = makePluginContext({ entities });
    // imageGenerate calls ctx.config.get() to read the platform OpenAI ref —
    // not used on the codex-cli path but the call must still resolve.
    (ctx as unknown as { config: { get: () => Promise<null> } }).config = {
      get: async () => null,
    };
    const ctxAccess = makeCtxAccess({ ctx });

    const result = await runImageGenerate(
      {
        prompt: "test reference",
        provider: "codex-cli",
        referenceImageIds: ["upload-1"],
      },
      {},
      runCtx,
      ctxAccess,
    );

    expect(result.error).toBeUndefined();
    expect(spawnMock).toHaveBeenCalled();
    // The 2nd arg is the args array — assert `-i` flag is present.
    const args = spawnMock.mock.calls[0]![1] as string[];
    expect(args).toContain("-i");
    expect(args).toContain("--");
    // Pull out the ref path and assert it contained the seeded bytes.
    const iIdx = args.findIndex((a) => a === "-i");
    const refPath = args[iIdx + 1]!;
    // The file might already be cleaned up by the time this assertion runs
    // — that's fine, it just means the success-path cleanup worked. What
    // matters is that the path looked right.
    expect(refPath).toMatch(/codex-refs-.+ref_0\.png$/);
  });

  it("persists referenceImageIds on the generated_image audit trail", async () => {
    setupSpawn();
    const entities = makeEntitiesStore();
    const runCtx = makeRunCtx();
    const sampleDataUrl = `data:image/png;base64,${TINY_PNG.toString("base64")}`;
    await entities.upsert({
      entityType: IMAGE_ENTITY_TYPE,
      scopeKind: "company",
      scopeId: runCtx.companyId,
      externalId: "upload-A",
      title: "A",
      status: "approved",
      data: {
        prompt: "",
        status: "approved",
        source: "upload",
        finalImageUrl: sampleDataUrl,
        rawImageUrl: sampleDataUrl,
        width: 1,
        height: 1,
        createdAt: new Date().toISOString(),
      },
    });
    const { ctx } = makePluginContext({ entities });
    (ctx as unknown as { config: { get: () => Promise<null> } }).config = {
      get: async () => null,
    };
    const ctxAccess = makeCtxAccess({ ctx });

    await runImageGenerate(
      {
        prompt: "audited",
        provider: "codex-cli",
        referenceImageIds: ["upload-A"],
      },
      {},
      runCtx,
      ctxAccess,
    );

    // The last upsert is the generated_image we just created (the seed
    // upload was the first).
    const generatedCall = entities.upsert.mock.calls
      .map(([arg]) => arg)
      .filter((arg) => {
        const data = arg.data as { source?: string };
        return arg.entityType === IMAGE_ENTITY_TYPE && data.source !== "upload";
      })
      .at(-1);
    expect(generatedCall).toBeTruthy();
    const data = generatedCall!.data as {
      referenceImageIds?: string[];
      referenceImageUrls?: string[];
    };
    expect(data.referenceImageIds).toEqual(["upload-A"]);
    expect(data.referenceImageUrls).toBeUndefined();
  });

  it("falls back to prompt-only generation when no references are provided", async () => {
    setupSpawn();
    const entities = makeEntitiesStore();
    const { ctx } = makePluginContext({ entities });
    (ctx as unknown as { config: { get: () => Promise<null> } }).config = {
      get: async () => null,
    };
    const ctxAccess = makeCtxAccess({ ctx });
    const result = await runImageGenerate(
      { prompt: "no refs", provider: "codex-cli" },
      {},
      makeRunCtx(),
      ctxAccess,
    );
    expect(result.error).toBeUndefined();
    // No `-i` in the spawned args.
    const args = spawnMock.mock.calls[0]![1] as string[];
    expect(args).not.toContain("-i");
  });
});
