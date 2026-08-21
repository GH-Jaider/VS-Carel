import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  Direction,
  MAX_WORLD_SIZE,
  RuntimeError,
  VALID_CONDITIONS,
  World,
  validateKarelMap,
  type KarelMap,
  type RuntimeErrorKind,
} from "../src/index";

/** The .klm fixture shared with the other packages; also acts as a format regression. */
const SIMPLE_WORLD: unknown = JSON.parse(
  readFileSync(new URL("../../../examples/simple-world.klm", import.meta.url), "utf8")
);

/** A 5x5 world with Karel in the middle; every field can be overridden per test. */
function makeMap(overrides: Partial<KarelMap> = {}): KarelMap {
  return {
    dimensions: { width: 5, height: 5 },
    karel: { x: 3, y: 3, facing: "north", beepers: 0 },
    beepers: [],
    walls: [],
    ...overrides,
  };
}

function makeWorld(overrides: Partial<KarelMap> = {}): World {
  return new World(makeMap(overrides));
}

/** Asserts the call fails with a typed RuntimeError and hands the error back for message checks. */
function expectRuntimeError(fn: () => unknown, kind: RuntimeErrorKind): RuntimeError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(RuntimeError);
    expect((error as RuntimeError).kind).toBe(kind);
    return error as RuntimeError;
  }
  throw new Error(`Expected a RuntimeError of kind "${kind}", but the call returned normally`);
}

function errorsOf(data: unknown): string[] {
  const result = validateKarelMap(data);
  expect(result.ok).toBe(false);
  expect(result.map).toBeUndefined();
  return result.errors;
}

describe("validateKarelMap", () => {
  it("accepts the shared simple-world fixture and returns a normalized map", () => {
    const result = validateKarelMap(SIMPLE_WORLD);

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.map).toEqual(SIMPLE_WORLD);
  });

  it("rejects anything that is not a JSON object", () => {
    expect(errorsOf(null)).toEqual(["The map must be a JSON object"]);
    expect(errorsOf([])).toEqual(["The map must be a JSON object"]);
    expect(errorsOf("10x8")).toEqual(["The map must be a JSON object"]);
  });

  it("rejects dimensions that are zero, negative, fractional or above the maximum", () => {
    expect(errorsOf(makeMap({ dimensions: { width: 0, height: 5 } }))).toContain(
      '"dimensions.width" must be a whole number of at least 1'
    );
    expect(errorsOf(makeMap({ dimensions: { width: 5, height: -3 } }))).toContain(
      '"dimensions.height" must be a whole number of at least 1'
    );
    expect(errorsOf(makeMap({ dimensions: { width: 2.5, height: 5 } }))).toContain(
      '"dimensions.width" must be a whole number of at least 1'
    );
    expect(
      errorsOf(makeMap({ dimensions: { width: MAX_WORLD_SIZE + 1, height: 5 } }))
    ).toContain(`"dimensions.width" cannot be larger than ${MAX_WORLD_SIZE}`);
    expect(
      errorsOf(makeMap({ dimensions: { width: 5, height: MAX_WORLD_SIZE + 1 } }))
    ).toContain(`"dimensions.height" cannot be larger than ${MAX_WORLD_SIZE}`);

    // The maximum itself is still a legal world.
    expect(
      validateKarelMap(makeMap({ dimensions: { width: MAX_WORLD_SIZE, height: MAX_WORLD_SIZE } })).ok
    ).toBe(true);
  });

  it("rejects a Karel standing outside the world and names the offending corner", () => {
    expect(errorsOf(makeMap({ karel: { x: 6, y: 1, facing: "north", beepers: 0 } }))).toEqual([
      "Karel is outside the world: (6, 1) in a 5x5 world",
    ]);
    expect(errorsOf(makeMap({ karel: { x: 1, y: 0, facing: "north", beepers: 0 } }))).toEqual([
      "Karel is outside the world: (1, 0) in a 5x5 world",
    ]);
  });

  it("rejects an invalid facing but accepts the one-letter abbreviations", () => {
    expect(errorsOf(makeMap({ karel: { x: 1, y: 1, facing: "up", beepers: 0 } }))).toEqual([
      '"karel.facing" has an invalid value: "up"',
    ]);

    // parseDirection also normalizes case and single letters, so validation must too.
    const result = validateKarelMap(makeMap({ karel: { x: 1, y: 1, facing: "E", beepers: 0 } }));
    expect(result.ok).toBe(true);
    expect(result.map?.karel.facing).toBe(Direction.East);
  });

  it("rejects walls between cells that are not adjacent", () => {
    expect(
      errorsOf(makeMap({ walls: [{ from: { x: 1, y: 1 }, to: { x: 2, y: 2 } }] }))
    ).toEqual(["Wall #1: cells (1, 1) and (2, 2) are not adjacent"]);
    expect(
      errorsOf(makeMap({ walls: [{ from: { x: 1, y: 1 }, to: { x: 1, y: 3 } }] }))
    ).toEqual(["Wall #1: cells (1, 1) and (1, 3) are not adjacent"]);
    // A cell is not adjacent to itself either.
    expect(
      errorsOf(makeMap({ walls: [{ from: { x: 2, y: 2 }, to: { x: 2, y: 2 } }] }))
    ).toEqual(["Wall #1: cells (2, 2) and (2, 2) are not adjacent"]);
    expect(
      errorsOf(makeMap({ walls: [{ from: { x: 1, y: 1 }, to: { x: 1, y: 6 } }] }))
    ).toEqual(["Wall #1 touches a cell outside the world"]);
  });

  it("rejects beepers with a non-positive count or a corner outside the world", () => {
    expect(errorsOf(makeMap({ beepers: [{ x: 2, y: 2, count: 0 }] }))).toEqual([
      "Beeper #1 must have a count of at least 1",
    ]);
    expect(errorsOf(makeMap({ beepers: [{ x: 2, y: 2, count: -4 }] }))).toEqual([
      "Beeper #1 must have a count of at least 1",
    ]);
    expect(errorsOf(makeMap({ beepers: [{ x: 9, y: 2, count: 1 }] }))).toEqual([
      "Beeper #1 is outside the world: (9, 2)",
    ]);
  });

  it("reports every problem at once instead of stopping at the first one", () => {
    const errors = errorsOf(
      makeMap({
        karel: { x: 99, y: 1, facing: "sideways", beepers: -1 },
        beepers: [{ x: 2, y: 2, count: 1 }, { x: 2, y: 2, count: 0 }],
        walls: [{ from: { x: 1, y: 1 }, to: { x: 3, y: 3 } }],
      })
    );

    expect(errors).toHaveLength(5);
    // Indices in the messages are 1-based and refer to the position in the source array.
    expect(errors).toContain("Beeper #2 must have a count of at least 1");
    expect(errors).toContain("Wall #1: cells (1, 1) and (3, 3) are not adjacent");
  });
});

describe("World geometry", () => {
  it("puts (1,1) at the bottom-left, so moving north increases y", () => {
    const world = makeWorld({ karel: { x: 1, y: 1, facing: "north", beepers: 0 } });

    world.move();

    expect(world.karel.position).toEqual({ x: 1, y: 2 });
    expect(world.dimensions).toEqual({ width: 5, height: 5 });
  });

  it("walls block movement in both directions however they were declared", () => {
    // Declared from the *upper* cell downwards; wallKey must normalize the pair.
    const world = makeWorld({
      karel: { x: 2, y: 2, facing: "north", beepers: 0 },
      walls: [{ from: { x: 2, y: 3 }, to: { x: 2, y: 2 } }],
    });

    expect(world.hasWall({ x: 2, y: 2 }, { x: 2, y: 3 })).toBe(true);
    expect(world.hasWall({ x: 2, y: 3 }, { x: 2, y: 2 })).toBe(true);
    expect(world.hasWall({ x: 2, y: 2 }, { x: 3, y: 2 })).toBe(false);

    // Blocked walking north from below...
    expect(world.frontIsBlocked()).toBe(true);

    // ...and equally blocked walking south from above.
    const fromAbove = makeWorld({
      karel: { x: 2, y: 3, facing: "south", beepers: 0 },
      walls: [{ from: { x: 2, y: 2 }, to: { x: 2, y: 3 } }],
    });
    expect(fromAbove.frontIsBlocked()).toBe(true);
  });

  it("walls the border of the world on all four sides", () => {
    const topRow = makeWorld({ karel: { x: 3, y: 5, facing: "north", beepers: 0 } });
    const bottomRow = makeWorld({ karel: { x: 3, y: 1, facing: "south", beepers: 0 } });
    const leftColumn = makeWorld({ karel: { x: 1, y: 3, facing: "west", beepers: 0 } });
    const rightColumn = makeWorld({ karel: { x: 5, y: 3, facing: "east", beepers: 0 } });

    for (const world of [topRow, bottomRow, leftColumn, rightColumn]) {
      expect(world.frontIsBlocked()).toBe(true);
      expect(world.frontIsClear()).toBe(false);
    }

    // The corner (1,1) is blocked to the south and to the west at the same time.
    const corner = makeWorld({ karel: { x: 1, y: 1, facing: "south", beepers: 0 } });
    expect(corner.frontIsBlocked()).toBe(true);
    expect(corner.rightIsBlocked()).toBe(true); // right of south is west
    expect(corner.leftIsClear()).toBe(true); // left of south is east
  });

  it("throws a blocked RuntimeError when move() runs into a wall", () => {
    const world = makeWorld({
      karel: { x: 2, y: 2, facing: "north", beepers: 0 },
      walls: [{ from: { x: 2, y: 2 }, to: { x: 2, y: 3 } }],
    });

    const error = expectRuntimeError(() => world.move(), "blocked");
    expect(error.message).toBe("Karel hit a wall: the front is blocked");
    // An error shutoff must not move Karel.
    expect(world.karel.position).toEqual({ x: 2, y: 2 });
  });

  it("refuses to add a wall between cells that are not adjacent", () => {
    const world = makeWorld();

    // Note this is a plain Error, not a RuntimeError: it is a caller bug, not a shutoff.
    expect(() => world.addWall({ x: 1, y: 1 }, { x: 3, y: 1 })).toThrow(
      "Invalid wall: cells (1, 1) and (3, 1) are not adjacent"
    );
  });

  it("returns Karel to the original facing after four turnLeft() calls", () => {
    const world = makeWorld({ karel: { x: 3, y: 3, facing: "north", beepers: 0 } });
    const seen: Direction[] = [];

    for (let i = 0; i < 4; i++) {
      world.turnLeft();
      seen.push(world.karel.facing);
    }

    expect(seen).toEqual([Direction.West, Direction.South, Direction.East, Direction.North]);
    expect(world.karel.position).toEqual({ x: 3, y: 3 });
  });
});

describe("beepers", () => {
  it("moves a beeper from the corner to the bag and back", () => {
    const world = makeWorld({
      karel: { x: 3, y: 3, facing: "north", beepers: 0 },
      beepers: [{ x: 3, y: 3, count: 1 }],
    });

    world.pickBeeper();
    expect(world.getBeepers({ x: 3, y: 3 })).toBe(0);
    expect(world.karel.beepersInBag).toBe(1);
    expect(world.getAllBeepers()).toEqual([]); // emptied corners are dropped, not kept at 0

    world.putBeeper();
    expect(world.getBeepers({ x: 3, y: 3 })).toBe(1);
    expect(world.karel.beepersInBag).toBe(0);
  });

  it("throws no-beeper when picking from an empty corner", () => {
    const world = makeWorld({ karel: { x: 4, y: 2, facing: "north", beepers: 0 } });

    const error = expectRuntimeError(() => world.pickBeeper(), "no-beeper");
    expect(error.message).toBe("There is no beeper to pick up at corner (4, 2)");
    expect(world.karel.beepersInBag).toBe(0);
  });

  it("throws empty-bag when putting a beeper with an empty bag", () => {
    const world = makeWorld({ karel: { x: 3, y: 3, facing: "north", beepers: 1 } });

    world.putBeeper();
    const error = expectRuntimeError(() => world.putBeeper(), "empty-bag");
    expect(error.message).toBe("Karel's beeper bag is empty");
    // The failed put must not add a phantom beeper to the corner.
    expect(world.getBeepers({ x: 3, y: 3 })).toBe(1);
  });
});

describe("evaluateCondition", () => {
  /** Karel boxed in to the north and east, standing on beepers, carrying beepers. */
  const blockedNorth = () =>
    makeWorld({
      karel: { x: 3, y: 3, facing: "north", beepers: 1 },
      beepers: [{ x: 3, y: 3, count: 2 }],
      walls: [
        { from: { x: 3, y: 3 }, to: { x: 3, y: 4 } }, // in front of Karel
        { from: { x: 3, y: 3 }, to: { x: 4, y: 3 } }, // to Karel's right
      ],
    });

  /** The mirror image: open on every side, bare corner, empty bag, facing east. */
  const openEast = () => makeWorld({ karel: { x: 3, y: 3, facing: "east", beepers: 0 } });

  const cases: Array<[string, () => World, Record<string, boolean>]> = [
    [
      "boxed in to the north and east, on beepers, with a full bag",
      blockedNorth,
      {
        "front-is-clear": false,
        "front-is-blocked": true,
        "left-is-clear": true,
        "left-is-blocked": false,
        "right-is-clear": false,
        "right-is-blocked": true,
        "next-to-a-beeper": true,
        "not-next-to-a-beeper": false,
        "facing-north": true,
        "not-facing-north": false,
        "facing-south": false,
        "not-facing-south": true,
        "facing-east": false,
        "not-facing-east": true,
        "facing-west": false,
        "not-facing-west": true,
        "beeper-in-bag": true,
        "no-beeper-in-bag": false,
      },
    ],
    [
      "standing on an open corner facing east with an empty bag",
      openEast,
      {
        "front-is-clear": true,
        "front-is-blocked": false,
        "left-is-clear": true,
        "left-is-blocked": false,
        "right-is-clear": true,
        "right-is-blocked": false,
        "next-to-a-beeper": false,
        "not-next-to-a-beeper": true,
        "facing-north": false,
        "not-facing-north": true,
        "facing-south": false,
        "not-facing-south": true,
        "facing-east": true,
        "not-facing-east": false,
        "facing-west": false,
        "not-facing-west": true,
        "beeper-in-bag": false,
        "no-beeper-in-bag": true,
      },
    ],
  ];

  for (const [scenario, build, expected] of cases) {
    it(`answers all 18 conditions correctly when Karel is ${scenario}`, () => {
      // Guards the table against drifting out of sync with the language's condition list.
      expect(Object.keys(expected).sort()).toEqual([...VALID_CONDITIONS].sort());

      const world = build();
      const actual: Record<string, boolean> = {};
      for (const condition of Object.keys(expected)) {
        actual[condition] = world.evaluateCondition(condition);
      }

      expect(actual).toEqual(expected);
    });
  }

  it("matches condition names case-insensitively", () => {
    const world = openEast();

    expect(world.evaluateCondition("FRONT-IS-CLEAR")).toBe(true);
    expect(world.evaluateCondition("Facing-East")).toBe(true);
  });

  it("throws unknown-name for a condition that does not exist", () => {
    const world = makeWorld();

    const error = expectRuntimeError(() => world.evaluateCondition("front-is-lava"), "unknown-name");
    expect(error.message).toBe("Unknown condition 'front-is-lava'");
  });
});

describe("toJSON", () => {
  it("round-trips the fixture map unchanged and stays idempotent", () => {
    const map = validateKarelMap(SIMPLE_WORLD).map!;
    const snapshot = new World(map).toJSON();

    expect(snapshot).toEqual(map);
    expect(new World(snapshot).toJSON()).toEqual(snapshot);
  });

  it("normalizes duplicate beeper stacks and reversed walls on the way out", () => {
    const world = makeWorld({
      karel: { x: 1, y: 1, facing: "north", beepers: 2 },
      beepers: [
        { x: 2, y: 2, count: 3 },
        { x: 2, y: 2, count: 4 },
      ],
      walls: [{ from: { x: 3, y: 2 }, to: { x: 3, y: 1 } }],
    });

    const snapshot = world.toJSON();

    // Stacks on the same corner collapse into one, and the wall comes back in canonical order.
    expect(snapshot.beepers).toEqual([{ x: 2, y: 2, count: 7 }]);
    expect(snapshot.walls).toEqual([{ from: { x: 3, y: 1 }, to: { x: 3, y: 2 } }]);
    expect(snapshot.karel).toEqual({ x: 1, y: 1, facing: "north", beepers: 2 });
    expect(new World(snapshot).toJSON()).toEqual(snapshot);
  });

  it("snapshots the live state, not the map it was built from", () => {
    const map = makeMap({
      karel: { x: 1, y: 1, facing: "north", beepers: 1 },
      beepers: [{ x: 1, y: 1, count: 1 }],
    });
    const world = new World(map);

    world.pickBeeper();
    world.move();

    expect(world.toJSON().karel).toEqual({ x: 1, y: 2, facing: "north", beepers: 2 });
    expect(world.toJSON().beepers).toEqual([]);
    // The source map is never written back to: reset means rebuilding from it.
    expect(map.karel).toEqual({ x: 1, y: 1, facing: "north", beepers: 1 });
    expect(map.beepers).toEqual([{ x: 1, y: 1, count: 1 }]);
  });
});
