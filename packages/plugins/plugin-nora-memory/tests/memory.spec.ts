import { describe, expect, it } from "vitest";
import { chunkText, toVectorLiteral } from "../src/memory.js";
import manifest, { DB_NAMESPACE, EMBEDDING_DIM, PLUGIN_ID } from "../src/manifest.js";

describe("manifest", () => {
  it("declares the four memory tools", () => {
    const names = (manifest.tools ?? []).map((t) => t.name).sort();
    expect(names).toEqual(["memory_dream", "memory_list", "memory_recall", "memory_retain"]);
  });

  it("namespace matches the host derivation formula", () => {
    // plugin_<slug>_<sha256(pluginId)[:10]>
    expect(PLUGIN_ID).toBe("paperclipai.plugin-nora-memory");
    expect(DB_NAMESPACE).toBe("plugin_nora_memory_bdc0493c33");
  });

  it("declares the required capabilities", () => {
    const caps = manifest.capabilities ?? [];
    for (const cap of [
      "database.namespace.migrate",
      "database.namespace.read",
      "database.namespace.write",
      "agent.tools.register",
      "http.outbound",
    ]) {
      expect(caps).toContain(cap);
    }
  });

  it("has no UI / agents / routines (worker-only plugin)", () => {
    expect(manifest.entrypoints?.ui).toBeUndefined();
    expect(manifest.agents).toBeUndefined();
    expect(manifest.routines).toBeUndefined();
  });
});

describe("chunkText", () => {
  it("keeps a short text as a single chunk", () => {
    const out = chunkText("une phrase courte");
    expect(out).toHaveLength(1);
    expect(out[0]).toBe("une phrase courte");
  });

  it("splits a long text into overlapping chunks", () => {
    const words = Array.from({ length: 1000 }, (_, i) => `mot${i}`).join(" ");
    const out = chunkText(words);
    expect(out.length).toBeGreaterThan(1);
    // each chunk non-empty
    for (const c of out) expect(c.trim().length).toBeGreaterThan(0);
    // overlap: last words of chunk N reappear at the start of chunk N+1
    const firstChunkWords = out[0]!.split(/\s+/);
    const secondChunkWords = out[1]!.split(/\s+/);
    expect(secondChunkWords[0]).toBe(firstChunkWords[firstChunkWords.length - 40]);
  });
});

describe("toVectorLiteral", () => {
  it("formats a number array as a pgvector literal", () => {
    expect(toVectorLiteral([0.1, 0.2, 0.3])).toBe("[0.1,0.2,0.3]");
  });

  it("round-trips the expected embedding dimension", () => {
    const vec = Array.from({ length: EMBEDDING_DIM }, () => 0);
    const lit = toVectorLiteral(vec);
    expect(lit.startsWith("[")).toBe(true);
    expect(lit.endsWith("]")).toBe(true);
    expect(lit.split(",")).toHaveLength(EMBEDDING_DIM);
  });
});
