/**
 * The world-editing rules, tested without a canvas or a pointer.
 *
 * Two properties matter more than any single case here and are checked for
 * every function: the result of an edit still passes the core's
 * `validateKarelMap` — otherwise the editor could build a world the CLI and
 * the extension refuse to open — and the input map is never mutated, because
 * the Session holds it and undo is nothing more than the previous value.
 *
 * Where the semantics belong to the core rather than to the editor (which way
 * a left turn goes, which cells a wall separates) the assertion is made
 * against the core itself, not against a constant copied out of it.
 */

import { describe, expect, it } from "vitest";
import { MAX_WORLD_SIZE, World, validateKarelMap, type KarelMap, type Wall } from "@karel/core";
import {
  beepersAt,
  changeBeepers,
  clearBeepers,
  clearWalls,
  placeKarel,
  resize,
  setBag,
  toggleWall,
  turnKarel,
} from "../src/draft";

/** A world with something of everything, so an edit has neighbours to disturb. */
function base(): KarelMap {
  return {
    dimensions: { width: 10, height: 8 },
    karel: { x: 3, y: 4, facing: "north", beepers: 5 },
    beepers: [
      { x: 2, y: 2, count: 1 },
      { x: 9, y: 7, count: 3 },
    ],
    walls: [
      { from: { x: 4, y: 3 }, to: { x: 4, y: 4 } },
      { from: { x: 6, y: 2 }, to: { x: 7, y: 2 } },
    ],
  };
}

function snapshot(map: KarelMap): string {
  return JSON.stringify(map);
}

/** Every function must leave a map the core still accepts. */
function expectValid(map: KarelMap): void {
  const result = validateKarelMap(JSON.parse(JSON.stringify(map)));
  expect(result.errors).toEqual([]);
  expect(result.ok).toBe(true);
}

function hasWall(map: KarelMap, wall: Wall): boolean {
  return map.walls.some(
    (w) =>
      (w.from.x === wall.from.x &&
        w.from.y === wall.from.y &&
        w.to.x === wall.to.x &&
        w.to.y === wall.to.y) ||
      (w.from.x === wall.to.x &&
        w.from.y === wall.to.y &&
        w.to.x === wall.from.x &&
        w.to.y === wall.from.y)
  );
}

describe("toggleWall", () => {
  it("adds a wall to a bare boundary", () => {
    const next = toggleWall(base(), { from: { x: 1, y: 1 }, to: { x: 2, y: 1 } });
    expect(next.walls).toHaveLength(3);
    expect(hasWall(next, { from: { x: 1, y: 1 }, to: { x: 2, y: 1 } })).toBe(true);
  });

  it("removes a wall that is already there", () => {
    const wall = { from: { x: 4, y: 3 }, to: { x: 4, y: 4 } };
    const next = toggleWall(base(), wall);
    expect(next.walls).toHaveLength(1);
    expect(hasWall(next, wall)).toBe(false);
  });

  it("removes a wall written the other way round", () => {
    // The click that erases a wall is rarely the click that drew it, so the
    // two endpoints can arrive swapped. If this fails the wall looks
    // indelible: every attempt to remove it adds a duplicate instead.
    const reversed = { from: { x: 4, y: 4 }, to: { x: 4, y: 3 } };
    const next = toggleWall(base(), reversed);
    expect(next.walls).toHaveLength(1);
    expect(hasWall(next, reversed)).toBe(false);
  });

  it("comes back to where it started after two toggles, in either order", () => {
    const wall = { from: { x: 5, y: 5 }, to: { x: 5, y: 6 } };
    const flipped = { from: { x: 5, y: 6 }, to: { x: 5, y: 5 } };
    const once = toggleWall(base(), wall);
    expect(toggleWall(once, flipped).walls).toEqual(base().walls);
  });

  it("leaves the walls it was not asked about alone", () => {
    const next = toggleWall(base(), { from: { x: 4, y: 3 }, to: { x: 4, y: 4 } });
    expect(hasWall(next, { from: { x: 6, y: 2 }, to: { x: 7, y: 2 } })).toBe(true);
  });

  it("keeps horizontal and vertical boundaries of the same corner apart", () => {
    // (3,3)-(4,3) and (3,3)-(3,4) share a corner but are different walls;
    // a key that lost the axis would make one erase the other.
    const first = toggleWall(base(), { from: { x: 3, y: 3 }, to: { x: 4, y: 3 } });
    const both = toggleWall(first, { from: { x: 3, y: 3 }, to: { x: 3, y: 4 } });
    expect(both.walls).toHaveLength(4);
  });

  it("does not confuse boundaries whose coordinates differ only in digits", () => {
    // "1,11" and "11,1" are the same characters in a different order; a key
    // built by concatenation without a separator would collide.
    const map = resize(base(), 20, 20);
    const a = toggleWall(map, { from: { x: 1, y: 11 }, to: { x: 2, y: 11 } });
    const b = toggleWall(a, { from: { x: 11, y: 1 }, to: { x: 12, y: 1 } });
    expect(b.walls).toHaveLength(map.walls.length + 2);
  });

  it("produces a wall the core's World actually blocks, from both sides", () => {
    const wall = { from: { x: 5, y: 5 }, to: { x: 6, y: 5 } };
    const world = new World(toggleWall(base(), wall));
    expect(world.hasWall(wall.from, wall.to)).toBe(true);
    expect(world.hasWall(wall.to, wall.from)).toBe(true);
  });
});

describe("changeBeepers", () => {
  it("adds to an empty corner", () => {
    const next = changeBeepers(base(), 5, 5, 1);
    expect(beepersAt(next, 5, 5)).toBe(1);
  });

  it("adds to an existing pile", () => {
    const next = changeBeepers(base(), 9, 7, 2);
    expect(beepersAt(next, 9, 7)).toBe(5);
  });

  it("subtracts from a pile", () => {
    const next = changeBeepers(base(), 9, 7, -1);
    expect(beepersAt(next, 9, 7)).toBe(2);
  });

  it("floors at zero rather than going negative", () => {
    const next = changeBeepers(base(), 9, 7, -99);
    expect(beepersAt(next, 9, 7)).toBe(0);
  });

  it("removes the pile entirely when it reaches zero", () => {
    // `count: 0` is not a legal .klm entry, so an emptied corner has to leave
    // the array rather than sit in it as a zero.
    const next = changeBeepers(base(), 2, 2, -1);
    expect(next.beepers.some((b) => b.x === 2 && b.y === 2)).toBe(false);
    expect(next.beepers).toHaveLength(1);
    expectValid(next);
  });

  it("does not store a zero when subtracting from a bare corner", () => {
    const next = changeBeepers(base(), 7, 7, -1);
    expect(next.beepers).toHaveLength(2);
    expectValid(next);
  });

  it("keeps the other piles as they were", () => {
    const next = changeBeepers(base(), 2, 2, -1);
    expect(beepersAt(next, 9, 7)).toBe(3);
  });

  it("ignores corners outside the world", () => {
    const map = base();
    for (const [x, y] of [
      [0, 1],
      [1, 0],
      [11, 4],
      [4, 9],
      [-3, -3],
    ]) {
      expect(changeBeepers(map, x, y, 1)).toEqual(map);
    }
  });

  it("accepts the four corners of the world", () => {
    for (const [x, y] of [
      [1, 1],
      [10, 1],
      [1, 8],
      [10, 8],
    ]) {
      const next = changeBeepers(base(), x, y, 4);
      expect(beepersAt(next, x, y)).toBe(4);
      expectValid(next);
    }
  });
});

describe("beepersAt", () => {
  it("reads a pile and reports zero for a bare corner", () => {
    expect(beepersAt(base(), 9, 7)).toBe(3);
    expect(beepersAt(base(), 9, 8)).toBe(0);
  });
});

describe("placeKarel", () => {
  it("moves Karel inside the world", () => {
    const next = placeKarel(base(), 7, 2);
    expect(next.karel.x).toBe(7);
    expect(next.karel.y).toBe(2);
  });

  it("keeps his facing and his bag", () => {
    const next = placeKarel(base(), 7, 2);
    expect(next.karel.facing).toBe("north");
    expect(next.karel.beepers).toBe(5);
  });

  it("refuses positions outside the world", () => {
    const map = base();
    for (const [x, y] of [
      [0, 4],
      [11, 4],
      [3, 0],
      [3, 9],
    ]) {
      expect(placeKarel(map, x, y)).toEqual(map);
    }
  });

  it("accepts the far corner", () => {
    expectValid(placeKarel(base(), 10, 8));
  });
});

describe("turnKarel", () => {
  it("turns to the left, the way the core does", () => {
    // The editor must not invent its own rotation: whatever World.turnLeft
    // does to a facing is what the button has to do.
    for (const facing of ["north", "west", "south", "east"]) {
      const map = { ...base(), karel: { ...base().karel, facing } };
      const world = new World(map);
      world.turnLeft();
      expect(turnKarel(map).karel.facing).toBe(world.karel.facing);
    }
  });

  it("goes north -> west -> south -> east", () => {
    let map = { ...base(), karel: { ...base().karel, facing: "north" } };
    map = turnKarel(map);
    expect(map.karel.facing).toBe("west");
    map = turnKarel(map);
    expect(map.karel.facing).toBe("south");
    map = turnKarel(map);
    expect(map.karel.facing).toBe("east");
  });

  it("comes back to the start after four turns", () => {
    for (const facing of ["north", "west", "south", "east"]) {
      let map = { ...base(), karel: { ...base().karel, facing } };
      for (let i = 0; i < 4; i++) {
        map = turnKarel(map);
      }
      expect(map.karel.facing).toBe(facing);
    }
  });

  it("leaves the rest of Karel alone", () => {
    const next = turnKarel(base());
    expect(next.karel.x).toBe(3);
    expect(next.karel.y).toBe(4);
    expect(next.karel.beepers).toBe(5);
  });
});

describe("setBag", () => {
  it("sets the bag", () => {
    expect(setBag(base(), 12).karel.beepers).toBe(12);
  });

  it("empties the bag", () => {
    expect(setBag(base(), 0).karel.beepers).toBe(0);
  });

  it("floors at zero", () => {
    expect(setBag(base(), -7).karel.beepers).toBe(0);
  });

  it("truncates a fraction, because .klm counts are integers", () => {
    expect(setBag(base(), 3.9).karel.beepers).toBe(3);
    expectValid(setBag(base(), 3.9));
  });

  it("leaves Karel where he stands", () => {
    const next = setBag(base(), 1);
    expect(next.karel).toMatchObject({ x: 3, y: 4, facing: "north" });
  });
});

describe("resize", () => {
  it("grows without losing anything", () => {
    const next = resize(base(), 20, 15);
    expect(next.dimensions).toEqual({ width: 20, height: 15 });
    expect(next.beepers).toEqual(base().beepers);
    expect(next.walls).toEqual(base().walls);
    expect(next.karel).toEqual(base().karel);
  });

  it("drops beepers left outside a shrunken world", () => {
    const next = resize(base(), 5, 5);
    expect(next.beepers).toEqual([{ x: 2, y: 2, count: 1 }]);
    expectValid(next);
  });

  it("drops walls whose far side no longer exists", () => {
    const next = resize(base(), 5, 5);
    // (6,2)-(7,2) is gone with the columns it joined; (4,3)-(4,4) survives.
    expect(next.walls).toEqual([{ from: { x: 4, y: 3 }, to: { x: 4, y: 4 } }]);
    expectValid(next);
  });

  it("moves Karel inside instead of dropping him", () => {
    const next = resize(base(), 2, 2);
    expect(next.karel.x).toBe(2);
    expect(next.karel.y).toBe(2);
    expectValid(next);
  });

  it("leaves Karel alone when he already fits", () => {
    expect(resize(base(), 5, 5).karel).toEqual(base().karel);
  });

  it("clamps a size of zero or less up to 1", () => {
    expect(resize(base(), 0, 0).dimensions).toEqual({ width: 1, height: 1 });
    expect(resize(base(), -5, -5).dimensions).toEqual({ width: 1, height: 1 });
    expectValid(resize(base(), -5, -5));
  });

  it("puts Karel on the only corner of a 1x1 world", () => {
    const next = resize(base(), 1, 1);
    expect(next.karel).toMatchObject({ x: 1, y: 1 });
    expect(next.beepers).toEqual([]);
    expect(next.walls).toEqual([]);
    expectValid(next);
  });

  it("clamps down to the core's maximum", () => {
    expect(resize(base(), 1000, 1000).dimensions).toEqual({
      width: MAX_WORLD_SIZE,
      height: MAX_WORLD_SIZE,
    });
    expectValid(resize(base(), 1000, 1000));
  });

  it("accepts exactly the maximum", () => {
    expect(resize(base(), MAX_WORLD_SIZE, MAX_WORLD_SIZE).dimensions).toEqual({
      width: MAX_WORLD_SIZE,
      height: MAX_WORLD_SIZE,
    });
  });

  it("truncates a fractional size to an integer", () => {
    // Dimensions come from a number input, which happily reports 2.7.
    expect(resize(base(), 2.7, 9.9).dimensions).toEqual({ width: 2, height: 9 });
    expectValid(resize(base(), 2.7, 9.9));
  });

  it("resizes the two axes independently", () => {
    const next = resize(base(), 3, 20);
    expect(next.dimensions).toEqual({ width: 3, height: 20 });
    expect(next.beepers).toEqual([{ x: 2, y: 2, count: 1 }]);
    expectValid(next);
  });

  it("keeps a world the core can build after a shrink", () => {
    const world = new World(resize(base(), 4, 4));
    expect(world.dimensions).toEqual({ width: 4, height: 4 });
  });
});

describe("clearBeepers and clearWalls", () => {
  it("clears the beepers and nothing else", () => {
    const next = clearBeepers(base());
    expect(next.beepers).toEqual([]);
    expect(next.walls).toEqual(base().walls);
    expect(next.karel).toEqual(base().karel);
    expectValid(next);
  });

  it("clears the walls and nothing else", () => {
    const next = clearWalls(base());
    expect(next.walls).toEqual([]);
    expect(next.beepers).toEqual(base().beepers);
    expectValid(next);
  });

  it("is harmless on an already empty world", () => {
    const empty = clearWalls(clearBeepers(base()));
    expect(clearWalls(clearBeepers(empty))).toEqual(empty);
  });
});

/**
 * A battery of every edit, applied one after another and each checked against
 * the core. This is the guarantee that matters: whatever the editor does to a
 * valid world, the result is still a world the CLI and the extension load.
 */
describe("every edit keeps the map valid", () => {
  const operations: Array<[string, (map: KarelMap) => KarelMap]> = [
    ["toggleWall adds", (m) => toggleWall(m, { from: { x: 1, y: 1 }, to: { x: 1, y: 2 } })],
    ["toggleWall removes", (m) => toggleWall(m, { from: { x: 4, y: 4 }, to: { x: 4, y: 3 } })],
    ["changeBeepers up", (m) => changeBeepers(m, 5, 5, 3)],
    ["changeBeepers to empty", (m) => changeBeepers(m, 2, 2, -1)],
    ["changeBeepers below zero", (m) => changeBeepers(m, 2, 2, -50)],
    ["changeBeepers outside", (m) => changeBeepers(m, 99, 99, 1)],
    ["placeKarel", (m) => placeKarel(m, 1, 1)],
    ["placeKarel outside", (m) => placeKarel(m, 0, 0)],
    ["turnKarel", (m) => turnKarel(m)],
    ["setBag", (m) => setBag(m, 40)],
    ["setBag negative", (m) => setBag(m, -1)],
    ["setBag fractional", (m) => setBag(m, 2.5)],
    ["resize larger", (m) => resize(m, 12, 12)],
    ["resize smaller", (m) => resize(m, 3, 3)],
    ["resize to one", (m) => resize(m, 0, 0)],
    ["resize past the maximum", (m) => resize(m, 1000, 1000)],
    ["resize fractional", (m) => resize(m, 6.7, 6.7)],
    ["clearBeepers", (m) => clearBeepers(m)],
    ["clearWalls", (m) => clearWalls(m)],
  ];

  it.each(operations)("%s leaves a valid map", (_name, apply) => {
    expectValid(apply(base()));
  });

  it("stays valid, and loadable, through the whole chain", () => {
    let map = base();
    for (const [, apply] of operations) {
      map = apply(map);
      expectValid(map);
    }
    // The last word belongs to the core: a World must be constructible from it.
    expect(() => new World(map)).not.toThrow();
  });
});

/**
 * Nothing here writes to its argument. The editor keeps previous maps around
 * for undo, and the Session holds the one being rendered, so a mutation in
 * place would corrupt history and the screen at once.
 */
describe("no edit mutates its input", () => {
  const operations: Array<[string, (map: KarelMap) => KarelMap]> = [
    ["toggleWall adds", (m) => toggleWall(m, { from: { x: 1, y: 1 }, to: { x: 1, y: 2 } })],
    ["toggleWall removes", (m) => toggleWall(m, { from: { x: 4, y: 3 }, to: { x: 4, y: 4 } })],
    ["changeBeepers", (m) => changeBeepers(m, 2, 2, 5)],
    ["changeBeepers to empty", (m) => changeBeepers(m, 2, 2, -1)],
    ["placeKarel", (m) => placeKarel(m, 8, 8)],
    ["turnKarel", (m) => turnKarel(m)],
    ["setBag", (m) => setBag(m, 99)],
    ["resize larger", (m) => resize(m, 30, 30)],
    ["resize smaller", (m) => resize(m, 2, 2)],
    ["clearBeepers", (m) => clearBeepers(m)],
    ["clearWalls", (m) => clearWalls(m)],
  ];

  it.each(operations)("%s leaves the input untouched", (_name, apply) => {
    const map = base();
    const before = snapshot(map);
    apply(map);
    expect(snapshot(map)).toBe(before);
  });

  it("does not share nested objects with the result", () => {
    // A shallow copy would pass the snapshot check above and still let a
    // later edit of the copy reach back into the original.
    const map = base();
    const next = toggleWall(map, { from: { x: 1, y: 1 }, to: { x: 1, y: 2 } });
    expect(next.beepers).not.toBe(map.beepers);
    expect(next.walls).not.toBe(map.walls);
    expect(next.karel).not.toBe(map.karel);
    expect(next.dimensions).not.toBe(map.dimensions);
    expect(next.beepers[0]).not.toBe(map.beepers[0]);
    expect(next.walls[0]).not.toBe(map.walls[0]);
    expect(next.walls[0].from).not.toBe(map.walls[0].from);

    next.beepers[0].count = 42;
    next.walls[0].from.x = 42;
    next.karel.beepers = 42;
    expect(snapshot(map)).toBe(snapshot(base()));
  });

  it("does not keep a reference to the wall it was handed", () => {
    const map = base();
    const wall: Wall = { from: { x: 1, y: 1 }, to: { x: 1, y: 2 } };
    const next = toggleWall(map, wall);
    wall.from.x = 99;
    expect(hasWall(next, { from: { x: 1, y: 1 }, to: { x: 1, y: 2 } })).toBe(true);
  });
});
