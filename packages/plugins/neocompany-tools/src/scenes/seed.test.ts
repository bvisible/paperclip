//// Neocompany Modification — seed integrity tests.
//// Guards the Reed-Blake-derived starter pack against accidental loss
//// (broken refactor, typo, etc.) and ensures each style ships at least
//// one variant.
//// End Neocompany Modification

import { describe, expect, it } from "vitest";
import { getStarterScenes } from "./seed.js";
import { ALL_SCENE_STYLES } from "./types.js";

const SCENES = getStarterScenes();

describe("getStarterScenes", () => {
  it("ships at least 30 variants total", () => {
    expect(SCENES.length).toBeGreaterThanOrEqual(30);
  });

  it("covers every declared style with at least one variant", () => {
    const stylesCovered = new Set(SCENES.map((v) => v.style));
    for (const style of ALL_SCENE_STYLES) {
      expect(stylesCovered.has(style), `style ${style} missing from seed`).toBe(true);
    }
  });

  it("every variant has a non-empty body and displayName", () => {
    for (const variant of SCENES) {
      expect(variant.displayName.length, `variant ${JSON.stringify(variant)} has empty displayName`).toBeGreaterThan(0);
      expect(variant.body.length, `variant ${variant.displayName} has empty body`).toBeGreaterThan(0);
    }
  });

  it("every variant references the {descriptor} token", () => {
    // The body must include {descriptor} so the product surfaces in the prompt.
    for (const variant of SCENES) {
      expect(variant.body, `variant ${variant.displayName} body missing {descriptor}`).toContain("{descriptor}");
    }
  });

  it("every variant carries isDefault=true (marker for seeded vs custom)", () => {
    for (const variant of SCENES) {
      expect(variant.isDefault, `variant ${variant.displayName} should be marked default`).toBe(true);
    }
  });

  it("order values are unique inside each style", () => {
    const byStyle = new Map<string, number[]>();
    for (const v of SCENES) {
      const arr = byStyle.get(v.style) ?? [];
      arr.push(v.order);
      byStyle.set(v.style, arr);
    }
    for (const [style, orders] of byStyle) {
      const unique = new Set(orders);
      expect(unique.size, `style ${style} has duplicate order values`).toBe(orders.length);
    }
  });

  it("slide_hero variants are intended for 16:9 (body mentions landscape)", () => {
    const slideHeros = SCENES.filter((v) => v.style === "slide_hero");
    expect(slideHeros.length).toBeGreaterThan(0);
    for (const v of slideHeros) {
      expect(v.body.toLowerCase()).toMatch(/16:9|landscape|widescreen/);
    }
  });

  it("story_vertical variants are intended for 9:16 (body mentions vertical)", () => {
    const stories = SCENES.filter((v) => v.style === "story_vertical");
    expect(stories.length).toBeGreaterThanOrEqual(3);
    for (const v of stories) {
      expect(v.body.toLowerCase()).toMatch(/9:16|vertical/);
    }
  });

  it("lifestyle pool includes both casual and formal audience variants", () => {
    const lifestyle = SCENES.filter((v) => v.style === "lifestyle");
    const hasCasual = lifestyle.some((v) => v.audience.includes("casual"));
    const hasFormal = lifestyle.some((v) => v.audience.includes("formal"));
    expect(hasCasual).toBe(true);
    expect(hasFormal).toBe(true);
  });
});
