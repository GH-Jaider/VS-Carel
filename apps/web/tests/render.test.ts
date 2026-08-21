/**
 * The renderer's arithmetic, tested without a canvas.
 *
 * Layout and hit-testing are inverses of each other, so most of these are
 * round trips: a cell drawn at a pixel must hit-test back to that cell, and a
 * wall drawn as a segment must hit-test back to that wall.
 */

import { describe, expect, it } from "vitest";
import type { Dimensions, KarelMap, Wall } from "@karel/core";
import {
  cellCenter,
  cellCorner,
  computeLayout,
  fitCellSize,
  hitTestAt,
  normalizeWall,
  wallSegment,
} from "../src/render/world";

/** The shape of examples/simple-world.klm, which is the typical world. */
const WORLD: Dimensions = { width: 10, height: 8 };
const CONTAINER: Dimensions = { width: 800, height: 600 };

const layout = computeLayout(WORLD, CONTAINER);

const WALLS: Wall[] = [
  { from: { x: 4, y: 3 }, to: { x: 4, y: 4 } },
  { from: { x: 4, y: 4 }, to: { x: 4, y: 5 } },
  { from: { x: 4, y: 5 }, to: { x: 5, y: 5 } },
  { from: { x: 6, y: 1 }, to: { x: 6, y: 2 } },
  { from: { x: 6, y: 2 }, to: { x: 7, y: 2 } },
];

function eachCell(fn: (x: number, y: number) => void): void {
  for (let x = 1; x <= WORLD.width; x++) {
    for (let y = 1; y <= WORLD.height; y++) {
      fn(x, y);
    }
  }
}

describe("fitCellSize", () => {
  it("fits the world into the container", () => {
    // 600 tall, minus padding, axis margin and both border walls, over 8 rows.
    expect(fitCellSize(WORLD, CONTAINER)).toBe(68);
  });

  it("gives the hidden axis margin back to the cells", () => {
    expect(fitCellSize(WORLD, CONTAINER, false)).toBeGreaterThan(
      fitCellSize(WORLD, CONTAINER, true)
    );
  });

  it("stays readable in a container too small for the world", () => {
    expect(fitCellSize({ width: 100, height: 100 }, { width: 120, height: 90 })).toBe(16);
  });

  it("stops growing in a container much larger than the world", () => {
    expect(fitCellSize({ width: 2, height: 2 }, { width: 4000, height: 3000 })).toBe(72);
  });

  it("survives a container that has not been laid out yet", () => {
    expect(fitCellSize(WORLD, { width: 0, height: 0 })).toBe(16);
  });
});

describe("computeLayout", () => {
  it("reserves the axis margin on the left and below the grid", () => {
    expect(layout.canvasWidth).toBe(25 + WORLD.width * layout.cell + 8);
    expect(layout.canvasHeight).toBe(25 + WORLD.height * layout.cell + 8);
    // The origin carries the margin plus whatever slack centring added, so
    // assert the gap it leaves rather than an absolute coordinate.
    const slackX = (CONTAINER.width - layout.canvasWidth) / 2;
    expect(layout.originX).toBe(slackX + 25 + 4);
    expect(layout.originY).toBe((CONTAINER.height - layout.canvasHeight) / 2 + 4);
  });

  it("centres the world in the space it is given", () => {
    const gapLeft = layout.originX - layout.axisMargin;
    const gapRight = CONTAINER.width - (layout.originX + WORLD.width * layout.cell);
    expect(gapLeft).toBeCloseTo(gapRight, 5);
  });

  it("keeps the origin on screen when the world is bigger than its box", () => {
    // Anchored rather than centred, so the (1,1) corner stays reachable.
    const cramped = computeLayout({ width: 100, height: 100 }, { width: 200, height: 200 });
    expect(cramped.originX).toBeGreaterThanOrEqual(cramped.axisMargin);
    expect(cramped.originY).toBeGreaterThanOrEqual(0);
  });

  it("drops the margin when the axes are hidden", () => {
    const bare = computeLayout(WORLD, CONTAINER, false);
    expect(bare.axisMargin).toBe(0);
    expect(bare.originX).toBe((CONTAINER.width - bare.canvasWidth) / 2 + 4);
  });
});

describe("cellCenter", () => {
  it("puts (1,1) at the bottom left, flipping the Y axis", () => {
    const bottomLeft = cellCenter(layout, 1, 1);
    const topLeft = cellCenter(layout, 1, WORLD.height);
    const bottomRight = cellCenter(layout, WORLD.width, 1);
    expect(bottomLeft.y).toBeGreaterThan(topLeft.y);
    expect(bottomRight.x).toBeGreaterThan(bottomLeft.x);
    expect(bottomLeft.x).toBe(layout.originX + layout.cell / 2);
    expect(topLeft.y).toBe(layout.originY + layout.cell / 2);
  });

  it("sits half a cell inside its own corner", () => {
    eachCell((x, y) => {
      const corner = cellCorner(layout, x, y);
      const center = cellCenter(layout, x, y);
      expect(center.x - corner.x).toBeCloseTo(layout.cell / 2);
      expect(center.y - corner.y).toBeCloseTo(layout.cell / 2);
    });
  });
});

describe("hitTestAt", () => {
  it("finds every cell from its own centre", () => {
    eachCell((x, y) => {
      const center = cellCenter(layout, x, y);
      expect(hitTestAt(layout, center.x, center.y)).toEqual({ kind: "cell", x, y });
    });
  });

  it("reports anything off the grid as outside", () => {
    const center = cellCenter(layout, 5, 5);
    expect(hitTestAt(layout, -1, center.y).kind).toBe("outside");
    expect(hitTestAt(layout, center.x, -1).kind).toBe("outside");
    // Past the far edge of the grid itself, which centring moved away from
    // canvasWidth: that is now the drawn extent, not a screen coordinate.
    const right = layout.originX + WORLD.width * layout.cell;
    const bottom = layout.originY + WORLD.height * layout.cell;
    expect(hitTestAt(layout, right + 1, center.y).kind).toBe("outside");
    // The axis strip below the grid is off the world too.
    expect(hitTestAt(layout, center.x, bottom + 10).kind).toBe("outside");
  });

  it("names the last cell for a point exactly on the far border", () => {
    const corner = cellCorner(layout, WORLD.width, 1);
    expect(hitTestAt(layout, corner.x + layout.cell, corner.y + layout.cell)).toEqual({
      kind: "cell",
      x: WORLD.width,
      y: 1,
    });
  });

  it("hits the vertical boundary between two cells from either side", () => {
    // The line between (3,4) and (4,4).
    const boundaryX = cellCorner(layout, 4, 4).x;
    const centerY = cellCenter(layout, 4, 4).y;
    const expected = { kind: "edge", wall: { from: { x: 3, y: 4 }, to: { x: 4, y: 4 } } };
    expect(hitTestAt(layout, boundaryX - layout.cell * 0.1, centerY)).toEqual(expected);
    expect(hitTestAt(layout, boundaryX + layout.cell * 0.1, centerY)).toEqual(expected);
  });

  it("hits the horizontal boundary between two stacked cells", () => {
    // The line between (5,5) and (5,6) is the top edge of (5,5).
    const boundaryY = cellCorner(layout, 5, 5).y;
    const centerX = cellCenter(layout, 5, 5).x;
    const expected = { kind: "edge", wall: { from: { x: 5, y: 5 }, to: { x: 5, y: 6 } } };
    expect(hitTestAt(layout, centerX, boundaryY - layout.cell * 0.1)).toEqual(expected);
    expect(hitTestAt(layout, centerX, boundaryY + layout.cell * 0.1)).toEqual(expected);
  });

  it("keeps the middle of a cell out of the edge zone", () => {
    const center = cellCenter(layout, 4, 4);
    const justInside = layout.cell * (0.5 - 0.25) - 1;
    expect(hitTestAt(layout, center.x - justInside, center.y).kind).toBe("cell");
    expect(hitTestAt(layout, center.x + justInside, center.y).kind).toBe("cell");
    expect(hitTestAt(layout, center.x, center.y - justInside).kind).toBe("cell");
  });

  it("refuses to toggle the rim, which is always walled", () => {
    const bottomLeft = cellCorner(layout, 1, 1);
    // A point hard against the left and bottom borders of the world.
    expect(hitTestAt(layout, bottomLeft.x + 1, bottomLeft.y + layout.cell - 1)).toEqual({
      kind: "cell",
      x: 1,
      y: 1,
    });
    const topRight = cellCorner(layout, WORLD.width, WORLD.height);
    expect(hitTestAt(layout, topRight.x + layout.cell - 1, topRight.y + 1)).toEqual({
      kind: "cell",
      x: WORLD.width,
      y: WORLD.height,
    });
  });

  it("picks the nearer boundary near a corner", () => {
    // The corner shared by (3,3), (4,3), (3,4) and (4,4): closer to the
    // vertical line than to the horizontal one.
    const corner = cellCorner(layout, 4, 4);
    const nearVertical = hitTestAt(
      layout,
      corner.x + layout.cell * 0.02,
      corner.y + layout.cell * 0.2
    );
    expect(nearVertical).toEqual({
      kind: "edge",
      wall: { from: { x: 3, y: 4 }, to: { x: 4, y: 4 } },
    });
    const nearHorizontal = hitTestAt(
      layout,
      corner.x + layout.cell * 0.2,
      corner.y + layout.cell * 0.02
    );
    expect(nearHorizontal).toEqual({
      kind: "edge",
      wall: { from: { x: 4, y: 4 }, to: { x: 4, y: 5 } },
    });
  });

  it("works the same at every cell size", () => {
    for (const container of [
      { width: 200, height: 200 },
      { width: 1400, height: 1000 },
    ]) {
      const other = computeLayout(WORLD, container);
      const center = cellCenter(other, 7, 2);
      expect(hitTestAt(other, center.x, center.y)).toEqual({ kind: "cell", x: 7, y: 2 });
    }
  });
});

describe("wallSegment", () => {
  it("draws each wall on the boundary that hit-testing reports", () => {
    for (const wall of WALLS) {
      const segment = wallSegment(layout, wall);
      const midX = (segment.x1 + segment.x2) / 2;
      const midY = (segment.y1 + segment.y2) / 2;
      expect(hitTestAt(layout, midX, midY)).toEqual({ kind: "edge", wall });
    }
  });

  it("draws a wall between stacked cells horizontally, one cell long", () => {
    const segment = wallSegment(layout, WALLS[0]!);
    expect(segment.y1).toBe(segment.y2);
    expect(segment.x2 - segment.x1).toBe(layout.cell);
  });

  it("draws a wall between side-by-side cells vertically, one cell long", () => {
    const segment = wallSegment(layout, WALLS[2]!);
    expect(segment.x1).toBe(segment.x2);
    expect(segment.y2 - segment.y1).toBe(layout.cell);
  });
});

describe("normalizeWall", () => {
  it("gives one record per boundary, whichever side it was seen from", () => {
    const a = normalizeWall({ x: 4, y: 5 }, { x: 5, y: 5 });
    const b = normalizeWall({ x: 5, y: 5 }, { x: 4, y: 5 });
    expect(a).toEqual(b);
    expect(a.from).toEqual({ x: 4, y: 5 });
    const up = normalizeWall({ x: 2, y: 7 }, { x: 2, y: 6 });
    expect(up.from).toEqual({ x: 2, y: 6 });
  });
});

describe("the fixture world", () => {
  it("lays out every beeper and Karel inside the grid", () => {
    const map: Pick<KarelMap, "karel" | "beepers"> = {
      karel: { x: 1, y: 1, facing: "north", beepers: 5 },
      beepers: [
        { x: 3, y: 3, count: 2 },
        { x: 5, y: 5, count: 1 },
        { x: 8, y: 2, count: 3 },
      ],
    };
    const targets = [...map.beepers, map.karel];
    for (const target of targets) {
      const center = cellCenter(layout, target.x, target.y);
      expect(center.x).toBeGreaterThan(layout.originX);
      expect(center.x).toBeLessThan(layout.originX + WORLD.width * layout.cell);
      expect(hitTestAt(layout, center.x, center.y)).toEqual({
        kind: "cell",
        x: target.x,
        y: target.y,
      });
    }
  });
});
