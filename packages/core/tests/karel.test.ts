/**
 * Karel's own contract, the part World does not exercise for us.
 *
 * World tests reach Karel through move / turnLeft / conditions and only ever
 * from the facings those scenarios happen to use. The direction algebra
 * (left/right of each facing) and the JSON boundary are public API in their own
 * right — the .klm loader and every host that draws Karel depend on them — so
 * they get pinned here directly.
 */

import { describe, expect, it } from "vitest";

import { Direction, Karel, parseDirection } from "../src/index";

describe("parseDirection", () => {
  it("accepts the full name, the initial and any casing", () => {
    expect(["north", "NORTH", "NoRtH", "n", "N"].map(parseDirection)).toEqual(
      Array<Direction>(5).fill(Direction.North)
    );
    expect(parseDirection("west")).toBe(Direction.West);
    expect(parseDirection("S")).toBe(Direction.South);
    expect(parseDirection("e")).toBe(Direction.East);
  });

  it("throws on anything else, which is what makes .klm facing validation possible", () => {
    // validateKarelMap turns this throw into a collected error message, so it
    // must stay a throw and must stay total: no silent default to north.
    for (const bad of ["up", "northeast", "nn", "", " north"]) {
      expect(() => parseDirection(bad), bad).toThrow();
    }
  });
});

describe("direction algebra", () => {
  /** Karel away from every border, so all three neighbours are ordinary corners. */
  const at = (facing: Direction) => new Karel({ x: 5, y: 5 }, facing, 0);

  it("puts front, left and right on the right corners for each of the four facings", () => {
    // (1,1) is bottom-left, so north is +y and east is +x; left is
    // counter-clockwise from the facing, right is clockwise.
    const expected: Record<Direction, { front: number[]; left: number[]; right: number[] }> = {
      [Direction.North]: { front: [5, 6], left: [4, 5], right: [6, 5] },
      [Direction.East]: { front: [6, 5], left: [5, 6], right: [5, 4] },
      [Direction.South]: { front: [5, 4], left: [6, 5], right: [4, 5] },
      [Direction.West]: { front: [4, 5], left: [5, 4], right: [5, 6] },
    };

    for (const facing of Object.values(Direction)) {
      const karel = at(facing);
      expect(
        {
          front: [karel.frontPosition().x, karel.frontPosition().y],
          left: [karel.leftPosition().x, karel.leftPosition().y],
          right: [karel.rightPosition().x, karel.rightPosition().y],
        },
        facing
      ).toEqual(expected[facing]);
    }
  });

  it("agrees with itself: turning left twice faces the old right-hand corner", () => {
    const karel = at(Direction.North);
    const wasOnTheRight = karel.rightPosition();

    karel.turnLeft();
    karel.turnLeft();

    expect(karel.facing).toBe(Direction.South);
    expect(karel.leftPosition()).toEqual(wasOnTheRight);
  });

  it("keeps the reported position independent of the caller's object", () => {
    const start = { x: 2, y: 2 };
    const karel = new Karel(start, Direction.North, 0);

    start.x = 99;
    const reported = karel.position;
    reported.y = 99;

    // Both the constructor argument and the getter result are copies: a host
    // holding either one must not be able to teleport Karel.
    expect(karel.position).toEqual({ x: 2, y: 2 });
  });
});

describe("the JSON boundary", () => {
  it("round-trips through toJSON and fromJSON without losing anything", () => {
    const original = new Karel({ x: 4, y: 7 }, Direction.West, 3);

    const restored = Karel.fromJSON(original.toJSON());

    expect(restored.toJSON()).toEqual({ x: 4, y: 7, facing: "west", beepers: 3 });
    expect(restored.hasBeepersInBag()).toBe(true);
  });

  it("treats an absent beeper count as an empty bag and normalizes the facing", () => {
    // .klm files may omit "beepers", and validateKarelMap accepts abbreviations.
    const karel = Karel.fromJSON({ x: 2, y: 3, facing: "S" });

    expect(karel.toJSON()).toEqual({ x: 2, y: 3, facing: "south", beepers: 0 });
    expect(karel.hasBeepersInBag()).toBe(false);
  });

  it("refuses to hand out a beeper it does not have", () => {
    const karel = new Karel({ x: 1, y: 1 }, Direction.North, 1);

    expect(karel.putBeeper()).toBe(true);
    expect(karel.putBeeper()).toBe(false);
    // The failed put must not leave the bag negative, which would make
    // hasBeepersInBag() and beepersInBag() disagree.
    expect(karel.beepersInBag).toBe(0);
    expect(karel.hasBeepersInBag()).toBe(false);
  });
});
