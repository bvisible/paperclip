//// Neocompany Modification — tests for accumulateText (Wave 7.1e defense)
//// Pin the contract of the streaming-defense helper so any future refactor
//// must keep the two pathological branches handled (cumulative snapshot +
//// duplicate event).
//// End Neocompany Modification

import { describe, expect, it } from "vitest";
import { accumulateText } from "../text-accumulation.js";

describe("accumulateText", () => {
  // ── Empty / edge cases ────────────────────────────────────────────
  it("returns prev when incoming is empty", () => {
    expect(accumulateText("hello", "")).toBe("hello");
  });

  it("returns incoming when prev is empty (first token)", () => {
    expect(accumulateText("", "Hello")).toBe("Hello");
  });

  it("both empty → empty", () => {
    expect(accumulateText("", "")).toBe("");
  });

  // ── Branch 3: genuine token-level deltas (well-behaved adapter) ───
  describe("delta path (Branch 3 — genuine token append)", () => {
    it("appends a single character delta", () => {
      expect(accumulateText("Hello", " world")).toBe("Hello world");
    });

    it("simulates a normal token stream", () => {
      let buf = "";
      const tokens = ["Hello", ",", " how", " are", " you", "?"];
      for (const t of tokens) {
        buf = accumulateText(buf, t);
      }
      expect(buf).toBe("Hello, how are you?");
    });

    it("handles unicode tokens (multi-byte chars)", () => {
      let buf = "";
      for (const t of ["Bonjour", " 👋", " ça", " va", " ?"]) {
        buf = accumulateText(buf, t);
      }
      expect(buf).toBe("Bonjour 👋 ça va ?");
    });
  });

  // ── Branch 1: cumulative snapshot from buggy adapter ──────────────
  describe("cumulative snapshot path (Branch 1)", () => {
    it("replaces prev when incoming is a longer superstring starting with prev", () => {
      // Adapter emits "Oui" then "Oui, je me souviens" (cumulative).
      // Naive concat would give "OuiOui, je me souviens".
      let buf = accumulateText("", "Oui");
      buf = accumulateText(buf, "Oui, je me souviens");
      expect(buf).toBe("Oui, je me souviens");
    });

    it("handles a sequence of cumulative snapshots", () => {
      let buf = "";
      buf = accumulateText(buf, "Bon");
      buf = accumulateText(buf, "Bonjour");
      buf = accumulateText(buf, "Bonjour, comment");
      buf = accumulateText(buf, "Bonjour, comment ça va ?");
      expect(buf).toBe("Bonjour, comment ça va ?");
    });

    it("first event acts as both initial token and the 'whole snapshot'", () => {
      expect(accumulateText("", "Whole message")).toBe("Whole message");
    });
  });

  // ── Branch 2: duplicate event from buggy adapter ──────────────────
  describe("duplicate suppression path (Branch 2)", () => {
    it("ignores an event that repeats the previous chunk verbatim", () => {
      // Adapter sends "Super, et toi ?" then the same chunk again.
      // The whole previous output ends with the repeated chunk.
      let buf = accumulateText("", "Super, et toi ?");
      buf = accumulateText(buf, "Super, et toi ?");
      expect(buf).toBe("Super, et toi ?");
    });

    it("ignores a duplicate of the last suffix", () => {
      // Sequence: "Hello" then " world" then " world" again.
      let buf = accumulateText("", "Hello");
      buf = accumulateText(buf, " world");
      buf = accumulateText(buf, " world");
      expect(buf).toBe("Hello world");
    });

    it("does NOT suppress when the incoming chunk happens to equal a prior chunk in the middle (suffix match only)", () => {
      // "Hello world Hello" — appending "Hello" then "world" then "Hello"
      // The third "Hello" is NOT a suffix of "Hello world", so it gets appended.
      let buf = accumulateText("", "Hello");
      buf = accumulateText(buf, " world ");
      buf = accumulateText(buf, "Hello");
      expect(buf).toBe("Hello world Hello");
    });
  });

  // ── Mixed scenarios that proved problematic in the wild ───────────
  describe("real-world Wave 7.1e regressions", () => {
    it("avoids the 'OuiOui,, je je me me sou souviviensens' artefact", () => {
      // What naive concat would produce:
      //   prev = "Oui"; incoming = "Oui, je me souviens" → "OuiOui, je me souviens"
      let buf = accumulateText("", "Oui");
      buf = accumulateText(buf, "Oui, je me souviens");
      buf = accumulateText(buf, "Oui, je me souviens de toi.");
      expect(buf).toBe("Oui, je me souviens de toi.");
      expect(buf).not.toContain("OuiOui");
    });

    it("avoids the 'SuperSuper,, et et toi toi ?' duplicate artefact", () => {
      // Stream: "Super, et toi ?" sent twice.
      let buf = accumulateText("", "Super, et toi ?");
      buf = accumulateText(buf, "Super, et toi ?");
      expect(buf).toBe("Super, et toi ?");
      expect(buf).not.toContain("SuperSuper");
    });

    it("interleaves delta + duplicate (genuine streaming with a hiccup)", () => {
      let buf = accumulateText("", "Bonjour");
      buf = accumulateText(buf, ", ");
      buf = accumulateText(buf, ", "); // adapter duplicated this chunk
      buf = accumulateText(buf, "comment ");
      buf = accumulateText(buf, "ça va ?");
      expect(buf).toBe("Bonjour, comment ça va ?");
    });
  });

  // ── Pure function properties ──────────────────────────────────────
  describe("pure-function properties", () => {
    it("idempotence: calling twice with the same args yields the same output", () => {
      const a = accumulateText("Hello", " world");
      const b = accumulateText("Hello", " world");
      expect(a).toBe(b);
    });

    it("never mutates input strings (strings are immutable in JS, defensive smoke)", () => {
      const prev = "Hello";
      const incoming = " world";
      accumulateText(prev, incoming);
      expect(prev).toBe("Hello");
      expect(incoming).toBe(" world");
    });

    it("output length never decreases", () => {
      const cases: Array<[string, string]> = [
        ["", "a"],
        ["abc", "abc"],
        ["abc", "abcd"],
        ["abcdef", "def"],
        ["xyz", "abc"],
      ];
      for (const [prev, incoming] of cases) {
        const out = accumulateText(prev, incoming);
        expect(out.length, `prev="${prev}" incoming="${incoming}"`).toBeGreaterThanOrEqual(prev.length);
      }
    });
  });
});
