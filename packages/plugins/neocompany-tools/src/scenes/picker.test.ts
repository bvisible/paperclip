//// Neocompany Modification — picker tests.
//// Validates audience filtering, variant rotation, descriptor formatting,
//// and body interpolation independently of any DB / HTTP plumbing.
//// End Neocompany Modification

import { describe, expect, it } from "vitest";
import {
  audienceForProduct,
  formatProductDescriptor,
  interpolateBody,
  pickVariantByIndex,
  selectVariantPool,
} from "./picker.js";
import type { SceneVariantData } from "./types.js";

const lifestyleCasual: SceneVariantData = {
  style: "lifestyle",
  displayName: "Cobblestones — casual",
  body: "casual body {descriptor}",
  audience: ["casual"],
  order: 1,
};

const lifestyleFormal: SceneVariantData = {
  style: "lifestyle",
  displayName: "Boardroom — formal",
  body: "formal body {descriptor}",
  audience: ["formal"],
  order: 2,
};

const lifestyleNeutral: SceneVariantData = {
  style: "lifestyle",
  displayName: "Walking — neutral",
  body: "neutral body {descriptor}",
  audience: [],
  order: 3,
};

const studio: SceneVariantData = {
  style: "studio_creative",
  displayName: "Walnut",
  body: "walnut body {descriptor}",
  audience: [],
  order: 1,
};

const POOL = [lifestyleCasual, lifestyleFormal, lifestyleNeutral, studio];

describe("audienceForProduct", () => {
  it("returns ['casual'] for sneakers", () => {
    expect(audienceForProduct(["Sneakers", "Été 2026"])).toEqual(["casual"]);
  });

  it("returns ['formal'] for richelieus", () => {
    expect(audienceForProduct(["Richelieu"])).toEqual(["formal"]);
  });

  it("returns [] for mixed/unknown categories", () => {
    expect(audienceForProduct(["Bottines"])).toEqual([]);
    expect(audienceForProduct([])).toEqual([]);
    expect(audienceForProduct(["Accessoires"])).toEqual([]);
  });

  it("returns [] when categories contain both casual and formal hints", () => {
    // 'baskets richelieu' as one combined string — rare but handled.
    expect(audienceForProduct(["Baskets Richelieu"])).toEqual([]);
  });

  it("is case-insensitive", () => {
    expect(audienceForProduct(["SNEAKERS"])).toEqual(["casual"]);
    expect(audienceForProduct(["brogue", "été"])).toEqual(["formal"]);
  });
});

describe("selectVariantPool", () => {
  it("returns only variants of the requested style", () => {
    const pool = selectVariantPool({
      variants: POOL,
      style: "studio_creative",
      productAudience: [],
    });
    expect(pool).toHaveLength(1);
    expect(pool[0].displayName).toBe("Walnut");
  });

  it("returns every variant of the style when product audience is neutral", () => {
    const pool = selectVariantPool({
      variants: POOL,
      style: "lifestyle",
      productAudience: [],
    });
    expect(pool.map((v) => v.displayName)).toEqual([
      "Cobblestones — casual",
      "Boardroom — formal",
      "Walking — neutral",
    ]);
  });

  it("filters out formal variants for a casual product", () => {
    const pool = selectVariantPool({
      variants: POOL,
      style: "lifestyle",
      productAudience: ["casual"],
    });
    expect(pool.map((v) => v.displayName)).toEqual([
      "Cobblestones — casual",
      "Walking — neutral", // neutrals always pass
    ]);
  });

  it("filters out casual variants for a formal product", () => {
    const pool = selectVariantPool({
      variants: POOL,
      style: "lifestyle",
      productAudience: ["formal"],
    });
    expect(pool.map((v) => v.displayName)).toEqual([
      "Boardroom — formal",
      "Walking — neutral",
    ]);
  });

  it("sorts by `order` ascending", () => {
    const reverseOrder = [
      { ...lifestyleNeutral, order: 99 },
      { ...lifestyleCasual, order: 1 },
    ];
    const pool = selectVariantPool({
      variants: reverseOrder,
      style: "lifestyle",
      productAudience: [],
    });
    expect(pool.map((v) => v.order)).toEqual([1, 99]);
  });
});

describe("pickVariantByIndex", () => {
  it("wraps modulo the pool size", () => {
    const pool = [lifestyleCasual, lifestyleNeutral];
    expect(pickVariantByIndex(pool, 0)).toBe(lifestyleCasual);
    expect(pickVariantByIndex(pool, 1)).toBe(lifestyleNeutral);
    expect(pickVariantByIndex(pool, 2)).toBe(lifestyleCasual);
    expect(pickVariantByIndex(pool, 5)).toBe(lifestyleNeutral);
  });

  it("handles negative indices", () => {
    const pool = [lifestyleCasual, lifestyleNeutral, lifestyleFormal];
    expect(pickVariantByIndex(pool, -1)).toBe(lifestyleFormal);
    expect(pickVariantByIndex(pool, -4)).toBe(lifestyleFormal);
  });

  it("returns null on empty pool", () => {
    expect(pickVariantByIndex([], 0)).toBeNull();
  });
});

describe("formatProductDescriptor", () => {
  it("combines name + attributes when present", () => {
    expect(
      formatProductDescriptor({
        name: "Bradley",
        attributes: { pa_color: "cuir blanc", pa_matiere: "veau lisse", pa_semelle: "caoutchouc" },
      }),
    ).toBe("Bradley — cuir blanc — veau lisse — sole caoutchouc");
  });

  it("skips attributes whose value is already in the name", () => {
    expect(
      formatProductDescriptor({
        name: "Baskets Bradley cuir blanc",
        attributes: { color: "cuir blanc", matiere: "veau" },
      }),
    ).toBe("Baskets Bradley cuir blanc — veau");
  });

  it("falls back to the name alone when no useful attributes", () => {
    expect(formatProductDescriptor({ name: "Robe d'été", attributes: {} })).toBe("Robe d'été");
    expect(formatProductDescriptor({ name: "Robe d'été" } as never)).toBe("Robe d'été");
  });

  it("accepts both `pa_` and short attribute keys", () => {
    expect(
      formatProductDescriptor({
        name: "Item",
        attributes: { material: "lin" },
      }),
    ).toBe("Item — lin");
    expect(
      formatProductDescriptor({
        name: "Item",
        attributes: { pa_material: "coton" },
      }),
    ).toBe("Item — coton");
  });
});

describe("interpolateBody", () => {
  it("replaces all supported tokens", () => {
    const out = interpolateBody(
      "Generate {brand} shot of {descriptor} on a {city} street. Note: {description}.",
      {
        descriptor: "Bradley cuir blanc",
        title: "Bradley",
        brand: "Reed Blake 1835",
        description: "Sneakers casual",
        city: "Geneva",
      },
    );
    expect(out).toBe(
      "Generate Reed Blake 1835 shot of Bradley cuir blanc on a Geneva street. Note: Sneakers casual.",
    );
  });

  it("leaves unknown tokens intact", () => {
    const out = interpolateBody("Hello {foo} {descriptor}", {
      descriptor: "X",
      title: "T",
      brand: "B",
      description: "D",
    });
    expect(out).toBe("Hello {foo} X");
  });

  it("squeezes whitespace introduced by missing tokens", () => {
    // Body asks for {city} but tokens don't provide it: token stays as-is.
    const out = interpolateBody("Walking   through   {city}   today.", {
      descriptor: "X",
      title: "T",
      brand: "B",
      description: "D",
    });
    expect(out).toBe("Walking through {city} today.");
  });
});
