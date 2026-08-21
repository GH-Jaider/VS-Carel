/**
 * The world as text, held to the two promises the panel is built on: that the
 * same world is always the same document, and that a document the core accepts
 * comes back as the world it was written from.
 *
 * The worlds under test are built by running draft.ts's edits, in different
 * orders, rather than by writing the arrays out: the whole point of the
 * canonical form is that it survives the order the visitor happened to click
 * in, and a literal would never exercise that.
 */

import { describe, expect, it } from "vitest";
import { validateKarelMap, type KarelMap } from "@karel/core";

import { canonicalWorld, parseMapSource, sameWorld, serializeWorld } from "../src/mapsource";
import { changeBeepers, placeKarel, setBag, toggleWall, turnKarel } from "../src/draft";

function empty(width = 6, height = 4): KarelMap {
  return {
    dimensions: { width, height },
    karel: { x: 1, y: 1, facing: "east", beepers: 0 },
    beepers: [],
    walls: [],
  };
}

/** The same little world, built by clicking in one order… */
function forwards(): KarelMap {
  let world = empty();
  world = changeBeepers(world, 2, 1, 3);
  world = changeBeepers(world, 5, 3, 1);
  world = toggleWall(world, { from: { x: 2, y: 1 }, to: { x: 3, y: 1 } });
  world = toggleWall(world, { from: { x: 4, y: 2 }, to: { x: 4, y: 3 } });
  world = setBag(world, 7);
  world = placeKarel(world, 3, 2);
  return turnKarel(world);
}

/** …and in another, with a wall drawn from the far side and one undone. */
function backwards(): KarelMap {
  let world = empty();
  world = toggleWall(world, { from: { x: 4, y: 3 }, to: { x: 4, y: 2 } });
  world = toggleWall(world, { from: { x: 1, y: 1 }, to: { x: 2, y: 1 } });
  world = changeBeepers(world, 5, 3, 1);
  world = placeKarel(world, 3, 2);
  world = turnKarel(world);
  world = changeBeepers(world, 2, 1, 5);
  world = changeBeepers(world, 2, 1, -2);
  // Drawn, then taken away again: the boundary is bare, and no trace of it may
  // reach the file.
  world = toggleWall(world, { from: { x: 2, y: 1 }, to: { x: 1, y: 1 } });
  world = toggleWall(world, { from: { x: 3, y: 1 }, to: { x: 2, y: 1 } });
  world = setBag(world, 7);
  return world;
}

describe("serializeWorld", () => {
  it("writes the same text every time it is asked", () => {
    const world = forwards();
    expect(serializeWorld(world)).toBe(serializeWorld(world));
  });

  it("does not depend on the order of the edits that built the world", () => {
    expect(serializeWorld(backwards())).toBe(serializeWorld(forwards()));
  });

  it("reads a wall the same from either side", () => {
    const left = toggleWall(empty(), { from: { x: 2, y: 2 }, to: { x: 3, y: 2 } });
    const right = toggleWall(empty(), { from: { x: 3, y: 2 }, to: { x: 2, y: 2 } });
    expect(serializeWorld(right)).toBe(serializeWorld(left));
  });

  it("keeps the keys in the order a .klm is written in", () => {
    const text = serializeWorld(forwards());
    const keys = [...text.matchAll(/^ {2}"(\w+)"/gm)].map((match) => match[1]);
    expect(keys).toEqual(["dimensions", "karel", "beepers", "walls"]);
    expect(text.indexOf('"width"')).toBeLessThan(text.indexOf('"height"'));
    expect(text).toContain('"karel": { "x": 3, "y": 2, "facing": "north", "beepers": 7 }');
  });

  it("keeps a record on one line and an empty list on none", () => {
    expect(serializeWorld(empty())).toBe(
      [
        "{",
        '  "dimensions": { "width": 6, "height": 4 },',
        '  "karel": { "x": 1, "y": 1, "facing": "east", "beepers": 0 },',
        '  "beepers": [],',
        '  "walls": []',
        "}",
      ].join("\n")
    );
  });

  it("produces a file the core accepts", () => {
    const validated = validateKarelMap(JSON.parse(serializeWorld(forwards())));
    expect(validated.ok).toBe(true);
  });

  it("ends without a trailing newline, so a refill adds no empty line", () => {
    expect(serializeWorld(empty()).endsWith("}")).toBe(true);
  });
});

describe("the round trip", () => {
  it("gives back the world it was written from", () => {
    const world = forwards();
    const result = parseMapSource(serializeWorld(world));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.world).toEqual(canonicalWorld(world));
      expect(sameWorld(result.world, world)).toBe(true);
    }
  });

  it("is idempotent: printing what was read changes nothing", () => {
    const text = serializeWorld(forwards());
    const result = parseMapSource(text);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(serializeWorld(result.world)).toBe(text);
    }
  });

  it("takes a file written in another order and returns the canonical one", () => {
    const shuffled = JSON.stringify({
      walls: [
        { to: { x: 4, y: 2 }, from: { x: 4, y: 3 } },
        { to: { x: 3, y: 1 }, from: { x: 2, y: 1 } },
      ],
      beepers: [
        { x: 5, y: 3, count: 1 },
        { count: 3, y: 1, x: 2 },
      ],
      karel: { beepers: 7, facing: "north", y: 2, x: 3 },
      dimensions: { height: 4, width: 6 },
    });
    const result = parseMapSource(shuffled);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(serializeWorld(result.world)).toBe(serializeWorld(forwards()));
    }
  });
});

describe("parseMapSource", () => {
  it("reports where the JSON stopped making sense, without throwing", () => {
    const result = parseMapSource('{\n  "dimensions": { "width": 6,,\n}');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems).toHaveLength(1);
      expect(result.problems[0].message).not.toBe("");
      // Engines word this differently and one of them gives no position at
      // all, so the promise is only that a line, when there is one, is a line
      // this document has.
      const { line } = result.problems[0];
      if (line !== null) {
        expect(line).toBeGreaterThanOrEqual(1);
        expect(line).toBeLessThanOrEqual(3);
      }
    }
  });

  it("hands back the core's own words for a world that will not load", () => {
    const result = parseMapSource(
      JSON.stringify({
        dimensions: { width: 4, height: 4 },
        karel: { x: 9, y: 1, facing: "east", beepers: 0 },
        beepers: [{ x: 2, y: 9, count: 1 }],
        walls: [],
      })
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // One per fault, and the same sentences `validateKarelMap` gives the CLI.
      expect(result.problems).toHaveLength(2);
      expect(result.problems.map((p) => p.message)).toEqual(
        validateKarelMap({
          dimensions: { width: 4, height: 4 },
          karel: { x: 9, y: 1, facing: "east", beepers: 0 },
          beepers: [{ x: 2, y: 9, count: 1 }],
          walls: [],
        }).errors
      );
      expect(result.problems.every((p) => p.line === null)).toBe(true);
    }
  });

  it("refuses JSON that is not a world at all", () => {
    for (const text of ["", "   ", "[]", "null", '"a world"', "{}"]) {
      const result = parseMapSource(text);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.problems.length).toBeGreaterThan(0);
        expect(result.problems.every((p) => p.message.trim().length > 0)).toBe(true);
      }
    }
  });
});

describe("sameWorld", () => {
  it("ignores the order things were added in", () => {
    expect(sameWorld(forwards(), backwards())).toBe(true);
  });

  it("still notices a single beeper", () => {
    expect(sameWorld(forwards(), changeBeepers(forwards(), 6, 4, 1))).toBe(false);
  });
});
