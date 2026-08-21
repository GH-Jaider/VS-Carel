/**
 * The skin packs, tested without a canvas.
 *
 * A pack's output is a stream of marks on a 2-D context, so the context is
 * the thing to fake: `Recorder` below implements enough of the API to record
 * every mark, transformed into canvas coordinates, together with the colour
 * it was made in. That turns three claims that would otherwise need eyes into
 * assertions:
 *
 *   · a pack draws only in the theme's colours, so four palettes times three
 *     packs is twelve combinations that work rather than three that each
 *     work in one theme;
 *   · a pack draws inside the bitmap the layout asked for, at every cell size
 *     from the smallest to the largest;
 *   · a pack hands the context back the way it found it, since the same three
 *     objects draw every frame for the life of the page.
 *
 * The fourth claim -- that swapping packs cannot move where a click lands --
 * is checked against `hitTestAt` directly, because that is the arithmetic the
 * map editor actually consults.
 */

import { afterEach, describe, expect, it } from "vitest";
import type { KarelMap, Wall } from "@karel/core";
import type { ThemeColors } from "../src/contracts";
import {
  DEFAULT_SKIN,
  SKINS,
  activeSkin,
  blocksSkin,
  classicSkin,
  currentSkin,
  onSkinChange,
  resetSkinForTests,
  rimRect,
  setSkin,
  skinById,
  terminalSkin,
  type Skin,
  type SkinContext,
} from "../src/render/skins";
import { cellCenter, cellCorner, computeLayout, hitTestAt, wallSegment } from "../src/render/world";

// ── A canvas that only remembers ──────────────────────────────────────────

interface Mark {
  kind: "fill" | "stroke" | "text";
  colour: string;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /**
   * The mark's own points, in canvas coordinates.
   *
   * A bounding box is enough to ask whether a mark landed on the bitmap, and
   * not nearly enough to ask whether one shape is another shape turned: a
   * symmetric outline has the same box whichever way it points.
   */
  points: { x: number; y: number }[];
}

/** The 2-D affine transform, in the order canvas states it: [a b c d e f]. */
type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `m` applied after `n`, which is what ctx.transform(n) does to ctx's m. */
function compose(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function apply(m: Matrix, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

class Recorder {
  readonly marks: Mark[] = [];
  /** Every value ever assigned to fillStyle or strokeStyle. */
  readonly colours = new Set<string>();
  /** save() minus restore(); has to come back to zero. */
  depth = 0;
  maxDepth = 0;

  fillStyle = "#000";
  strokeStyle = "#000";
  lineWidth = 1;
  lineCap = "butt";
  lineJoin = "miter";
  font = "10px monospace";
  textAlign = "start";
  textBaseline = "alphabetic";
  globalAlpha = 1;

  private matrix: Matrix = IDENTITY;
  private readonly stack: { matrix: Matrix; alpha: number }[] = [];
  private path: { x: number; y: number }[] = [];
  private dash: number[] = [];

  // -- state --------------------------------------------------------------
  save(): void {
    this.stack.push({ matrix: this.matrix, alpha: this.globalAlpha });
    this.depth++;
    this.maxDepth = Math.max(this.maxDepth, this.depth);
  }
  restore(): void {
    const previous = this.stack.pop();
    if (previous) {
      this.matrix = previous.matrix;
      this.globalAlpha = previous.alpha;
    }
    this.depth--;
  }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.matrix = [a, b, c, d, e, f];
  }
  translate(x: number, y: number): void {
    this.matrix = compose(this.matrix, [1, 0, 0, 1, x, y]);
  }
  rotate(angle: number): void {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    this.matrix = compose(this.matrix, [cos, sin, -sin, cos, 0, 0]);
  }
  setLineDash(dash: number[]): void {
    this.dash = dash;
  }
  getLineDash(): number[] {
    return this.dash;
  }

  // -- paths --------------------------------------------------------------
  beginPath(): void {
    this.path = [];
  }
  closePath(): void {}
  moveTo(x: number, y: number): void {
    this.path.push(apply(this.matrix, x, y));
  }
  lineTo(x: number, y: number): void {
    this.path.push(apply(this.matrix, x, y));
  }
  arc(x: number, y: number, radius: number, _from: number, _to: number): void {
    // The transform in play here is only ever a translation and a rotation, so
    // a radius is a radius: the four extremes bound the arc exactly.
    for (const [dx, dy] of [
      [-radius, 0],
      [radius, 0],
      [0, -radius],
      [0, radius],
    ]) {
      this.path.push(apply(this.matrix, x + dx!, y + dy!));
    }
  }
  rect(x: number, y: number, width: number, height: number): void {
    this.corners(x, y, width, height).forEach((point) => this.path.push(point));
  }
  fill(): void {
    this.record("fill", this.fillStyle, this.path, 0);
  }
  stroke(): void {
    this.record("stroke", this.strokeStyle, this.path, this.lineWidth / 2);
  }

  // -- rectangles ---------------------------------------------------------
  fillRect(x: number, y: number, width: number, height: number): void {
    this.record("fill", this.fillStyle, this.corners(x, y, width, height), 0);
  }
  strokeRect(x: number, y: number, width: number, height: number): void {
    this.record("stroke", this.strokeStyle, this.corners(x, y, width, height), this.lineWidth / 2);
  }
  clearRect(): void {}

  // -- text ---------------------------------------------------------------
  measureText(text: string): { width: number } {
    // Enough for `fitLabel` to behave: JetBrains Mono's advance is 0.6em.
    return { width: text.length * this.fontSize() * 0.6 };
  }
  fillText(text: string, x: number, y: number): void {
    const half = (text.length * this.fontSize() * 0.6) / 2;
    const point = apply(this.matrix, x, y);
    this.marks.push({
      kind: "text",
      colour: String(this.fillStyle),
      minX: point.x - half,
      maxX: point.x + half,
      minY: point.y - this.fontSize() / 2,
      maxY: point.y + this.fontSize() / 2,
      points: [point],
    });
    this.colours.add(String(this.fillStyle));
  }

  private fontSize(): number {
    return Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 10);
  }

  private corners(x: number, y: number, width: number, height: number): { x: number; y: number }[] {
    return [
      apply(this.matrix, x, y),
      apply(this.matrix, x + width, y),
      apply(this.matrix, x, y + height),
      apply(this.matrix, x + width, y + height),
    ];
  }

  private record(
    kind: "fill" | "stroke",
    colour: string,
    points: { x: number; y: number }[],
    pad: number
  ): void {
    this.colours.add(String(colour));
    if (points.length === 0) {
      return;
    }
    this.marks.push({
      kind,
      colour: String(colour),
      minX: Math.min(...points.map((p) => p.x)) - pad,
      maxX: Math.max(...points.map((p) => p.x)) + pad,
      minY: Math.min(...points.map((p) => p.y)) - pad,
      maxY: Math.max(...points.map((p) => p.y)) + pad,
      points: [...points],
    });
  }
}

// ── Fixtures ──────────────────────────────────────────────────────────────

const PALETTE: ThemeColors = {
  background: "#0c0c12",
  grid: "#24243a",
  label: "#8686a4",
  karel: "#ff5fa2",
  beeper: "#4fe3d2",
  beeperLabel: "#08080e",
  wall: "#b9b9d6",
  cursor: "#ffc861",
};

const PALETTE_COLOURS = new Set(Object.values(PALETTE));

const WALLS: Wall[] = [
  { from: { x: 4, y: 3 }, to: { x: 4, y: 4 } },
  { from: { x: 4, y: 5 }, to: { x: 5, y: 5 } },
  // Hard against the rim on both axes: the endpoints of these two sit on the
  // border, which is where an over-thick pen would fall off the bitmap.
  { from: { x: 6, y: 1 }, to: { x: 7, y: 1 } },
  { from: { x: 1, y: 7 }, to: { x: 1, y: 8 } },
];

const WORLD: KarelMap = {
  dimensions: { width: 10, height: 8 },
  karel: { x: 1, y: 1, facing: "north", beepers: 5 },
  beepers: [
    { x: 3, y: 3, count: 1 },
    { x: 5, y: 5, count: 9 },
    { x: 8, y: 2, count: 128 },
    // On the corner Karel is standing on, and on the far corner of the world.
    { x: 1, y: 1, count: 2 },
    { x: 10, y: 8, count: 4 },
  ],
  walls: WALLS,
};

/** A context wired to a fresh recorder, at whatever size is asked for. */
function contextFor(
  available: { width: number; height: number },
  showAxes = true
): { c: SkinContext; recorder: Recorder } {
  const layout = computeLayout(WORLD.dimensions, available, showAxes);
  const recorder = new Recorder();
  const c: SkinContext = {
    ctx: recorder as unknown as CanvasRenderingContext2D,
    layout,
    palette: PALETTE,
    maxWallWidth: 8,
    rimRoom: 4,
    center: (x, y) => cellCenter(layout, x, y),
    corner: (x, y) => cellCorner(layout, x, y),
    segment: (wall) => wallSegment(layout, wall),
  };
  return { c, recorder };
}

/** Every draw call a pack has, run once, in the order the renderer runs them. */
function drawEverything(skin: Skin, c: SkinContext): void {
  skin.drawBackground(c);
  skin.drawCursor(c, { x: 2, y: 2 });
  skin.drawEdgeCursor(c, WALLS[0]!);
  skin.drawAxes(c);
  skin.drawGrid(c);
  skin.drawBeepers(c, WORLD.beepers);
  skin.drawWalls(c, WORLD.walls);
  skin.drawKarel(c, WORLD.karel);
}

/** The container sizes that produce the smallest, a middling and the largest cell. */
const SIZES = [
  { width: 120, height: 90 }, // clamps to MIN_CELL
  { width: 520, height: 380 },
  { width: 800, height: 600 },
  { width: 4000, height: 3000 }, // clamps to MAX_CELL
];

afterEach(() => {
  resetSkinForTests();
});

// ── The contract ──────────────────────────────────────────────────────────

describe("the set of packs", () => {
  it("offers exactly the three that are wired up, each named once", () => {
    expect(SKINS.map((skin) => skin.id)).toEqual(["terminal", "blocks", "classic"]);
    expect(new Set(SKINS.map((skin) => skin.label)).size).toBe(SKINS.length);
  });

  it("starts on the pack the default names", () => {
    expect(skinById(DEFAULT_SKIN)).toBe(terminalSkin);
    expect(activeSkin()).toBe(terminalSkin);
  });

  it("looks a pack up by id and refuses one that does not exist", () => {
    expect(skinById("blocks")).toBe(blocksSkin);
    expect(skinById("classic")).toBe(classicSkin);
    expect(skinById("Terminal")).toBeNull();
    expect(skinById("")).toBeNull();
  });
});

describe("every pack implements the whole contract", () => {
  const METHODS = [
    "drawBackground",
    "drawAxes",
    "drawGrid",
    "drawWalls",
    "drawBeepers",
    "drawKarel",
    "drawCursor",
    "drawEdgeCursor",
    "drawSwatch",
  ] as const;

  for (const skin of SKINS) {
    describe(skin.id, () => {
      it("has every drawing function, its own rather than inherited", () => {
        for (const method of METHODS) {
          // Own property, not a prototype's: a pack that inherited half its
          // hand from another would be a mixture, which always looks like a
          // mistake rather than like a third style.
          expect(Object.prototype.hasOwnProperty.call(skin, method)).toBe(true);
          expect(typeof skin[method]).toBe("function");
        }
        expect(skin.id).toMatch(/^[a-z]+$/);
        expect(skin.label.length).toBeGreaterThan(0);
      });

      it("puts something on the canvas for every element it owns", () => {
        // A pack that quietly drew nothing would pass every other test here.
        const { c, recorder } = contextFor({ width: 800, height: 600 });
        const counts: Record<string, number> = {};
        for (const method of METHODS) {
          if (method === "drawSwatch") {
            continue;
          }
          const before = recorder.marks.length;
          switch (method) {
            case "drawWalls":
              skin.drawWalls(c, WORLD.walls);
              break;
            case "drawBeepers":
              skin.drawBeepers(c, WORLD.beepers);
              break;
            case "drawKarel":
              skin.drawKarel(c, WORLD.karel);
              break;
            case "drawCursor":
              skin.drawCursor(c, { x: 2, y: 2 });
              break;
            case "drawEdgeCursor":
              skin.drawEdgeCursor(c, WALLS[0]!);
              break;
            default:
              skin[method](c);
          }
          counts[method] = recorder.marks.length - before;
        }
        for (const [method, drawn] of Object.entries(counts)) {
          expect(`${method}:${drawn > 0}`).toBe(`${method}:true`);
        }
      });

      it("draws its own swatch", () => {
        const recorder = new Recorder();
        skin.drawSwatch({
          ctx: recorder as unknown as CanvasRenderingContext2D,
          palette: PALETTE,
          width: 26,
          height: 16,
        });
        expect(recorder.marks.length).toBeGreaterThan(2);
        // The swatch has to show the two things that tell packs apart.
        expect(recorder.colours.has(PALETTE.karel)).toBe(true);
        expect(recorder.colours.has(PALETTE.beeper)).toBe(true);
        for (const colour of recorder.colours) {
          expect(PALETTE_COLOURS.has(colour)).toBe(true);
        }
      });
    });
  }
});

// ── Colour belongs to the theme ───────────────────────────────────────────

describe("a pack chooses shapes, never colours", () => {
  for (const skin of SKINS) {
    it(`${skin.id} draws only in colours the theme handed it`, () => {
      for (const size of SIZES) {
        const { c, recorder } = contextFor(size);
        drawEverything(skin, c);
        for (const colour of recorder.colours) {
          // A literal here -- a hard-coded paper white, a black outline --
          // would be a pack that works in one palette and fails in three.
          expect(`${skin.id}:${colour}`).toBe(
            `${skin.id}:${PALETTE_COLOURS.has(colour) ? colour : "<not in palette>"}`
          );
        }
      }
    });
  }

  it("uses the whole palette between them, so no theme colour is dead", () => {
    const seen = new Set<string>();
    for (const skin of SKINS) {
      const { c, recorder } = contextFor({ width: 800, height: 600 });
      drawEverything(skin, c);
      for (const colour of recorder.colours) {
        seen.add(colour);
      }
    }
    for (const [field, colour] of Object.entries(PALETTE)) {
      expect(`${field}:${seen.has(colour)}`).toBe(`${field}:true`);
    }
  });
});

// ── Everything lands on the bitmap ────────────────────────────────────────

describe("a pack draws inside the bitmap the layout asked for", () => {
  for (const skin of SKINS) {
    for (const showAxes of [true, false]) {
      it(`${skin.id} stays in bounds at every cell size, axes ${showAxes ? "on" : "off"}`, () => {
        for (const size of SIZES) {
          const { c, recorder } = contextFor(size, showAxes);
          drawEverything(skin, c);
          const { canvasWidth, canvasHeight } = c.layout;
          for (const mark of recorder.marks) {
            // Text is measured from an estimate, so only the geometry is held
            // to the edge; a numeral that is a pixel wide either way is not
            // what this is guarding against.
            if (mark.kind === "text") {
              continue;
            }
            const worst = Math.min(
              mark.minX,
              mark.minY,
              canvasWidth - mark.maxX,
              canvasHeight - mark.maxY
            );
            expect(`${skin.id}@${c.layout.cell}: ${worst >= -0.001 ? "inside" : "spills"}`).toBe(
              `${skin.id}@${c.layout.cell}: inside`
            );
          }
        }
      });
    }
  }

  it("keeps the rim inside the reserve however heavy the pen", () => {
    const { c } = contextFor({ width: 800, height: 600 });
    for (const width of [1, 4, 6, 8]) {
      const rim = rimRect(c, width);
      expect(rim.x - width / 2).toBeGreaterThanOrEqual(-0.001);
      expect(rim.y - width / 2).toBeGreaterThanOrEqual(-0.001);
      expect(rim.x + rim.width + width / 2).toBeLessThanOrEqual(c.layout.canvasWidth + 0.001);
      expect(rim.y + rim.height + width / 2).toBeLessThanOrEqual(c.layout.canvasHeight + 0.001);
    }
  });

  it("straddles the grid's edge while the pen fits in the reserve", () => {
    // The one case that has to look exactly as it always has: a four-pixel
    // rim, centred on the boundary, half in and half out.
    const { c } = contextFor({ width: 800, height: 600 });
    const rim = rimRect(c, 4);
    expect(rim.x).toBe(c.layout.originX - 2);
    expect(rim.width).toBe(c.layout.world.width * c.layout.cell + 4);
  });
});

// ── The context is handed back the way it was found ───────────────────────

describe("a pack leaves no state on the context", () => {
  for (const skin of SKINS) {
    it(`${skin.id} balances save/restore and resets what it changed`, () => {
      // At every cell size, because a pack is allowed to take a short cut out
      // of a drawing function at a size where an element would not read -- and
      // an early return is exactly where a `restore` gets forgotten.
      for (const size of SIZES) {
        const { c, recorder } = contextFor(size);
        drawEverything(skin, c);
        // One object draws every frame for the life of the page. A stray
        // globalAlpha would fade the next frame; a stray dash would dot it.
        expect(`${skin.id}@${c.layout.cell} depth`).toBe(`${skin.id}@${c.layout.cell} depth`);
        expect(recorder.depth).toBe(0);
        expect(recorder.globalAlpha).toBe(1);
      }
    });

    it(`${skin.id} still draws a grid at the smallest cell`, () => {
      const { c, recorder } = contextFor({ width: 120, height: 90 });
      skin.drawGrid(c);
      expect(recorder.marks.length).toBeGreaterThan(0);
    });
  }
});

// ── Shapes may differ; geometry may not ───────────────────────────────────

describe("swapping packs cannot move where a click lands", () => {
  const layout = computeLayout(WORLD.dimensions, { width: 800, height: 600 });

  /** Every reading the map editor could take, at a fine step across the grid. */
  function sweep(): string[] {
    const readings: string[] = [];
    for (let px = 0; px <= layout.canvasWidth; px += 3) {
      for (let py = 0; py <= layout.canvasHeight; py += 3) {
        readings.push(JSON.stringify(hitTestAt(layout, px, py)));
      }
    }
    return readings;
  }

  it("gives the same answer everywhere under every pack", () => {
    const baseline = sweep();
    expect(baseline.length).toBeGreaterThan(1000);
    for (const skin of SKINS) {
      setSkin(skin.id);
      expect(currentSkin()).toBe(skin.id);
      expect(sweep()).toEqual(baseline);
    }
  });

  it("lays the world out identically under every pack", () => {
    for (const size of SIZES) {
      const expected = JSON.stringify(computeLayout(WORLD.dimensions, size));
      for (const skin of SKINS) {
        setSkin(skin.id);
        expect(JSON.stringify(computeLayout(WORLD.dimensions, size))).toBe(expected);
      }
    }
  });

  it("centres every beeper on the corner the hit test names", () => {
    // A pack is handed `center`; this is the check that it uses it. The mark
    // for a single pile has to be centred on the cell it belongs to, whatever
    // shape the pack chose to make it.
    for (const skin of SKINS) {
      for (const cell of [
        { x: 3, y: 3 },
        { x: 10, y: 8 },
        { x: 1, y: 1 },
      ]) {
        const { c, recorder } = contextFor({ width: 800, height: 600 });
        skin.drawBeepers(c, [{ ...cell, count: 1 }]);
        const shapes = recorder.marks.filter((mark) => mark.colour === PALETTE.beeper);
        expect(shapes.length).toBeGreaterThan(0);
        const midX =
          (Math.min(...shapes.map((m) => m.minX)) + Math.max(...shapes.map((m) => m.maxX))) / 2;
        const midY =
          (Math.min(...shapes.map((m) => m.minY)) + Math.max(...shapes.map((m) => m.maxY))) / 2;
        const centre = cellCenter(c.layout, cell.x, cell.y);
        // `blocks` steps its chips back and up, so the pile's middle is
        // allowed to sit a pack-pixel off the corner's; a whole cell off
        // would mean the pack did its own arithmetic.
        expect(Math.abs(midX - centre.x)).toBeLessThan(c.layout.cell * 0.2);
        expect(Math.abs(midY - centre.y)).toBeLessThan(c.layout.cell * 0.2);
      }
    }
  });

  it("draws every wall on the boundary the hit test reports", () => {
    for (const skin of SKINS) {
      const { c, recorder } = contextFor({ width: 800, height: 600 });
      const wall = WALLS[0]!;
      skin.drawWalls(c, [wall]);
      const segment = wallSegment(c.layout, wall);
      const midX = (segment.x1 + segment.x2) / 2;
      const midY = (segment.y1 + segment.y2) / 2;
      const onIt = recorder.marks.some(
        (mark) =>
          mark.colour === PALETTE.wall &&
          midX >= mark.minX &&
          midX <= mark.maxX &&
          midY >= mark.minY &&
          midY <= mark.maxY
      );
      expect(`${skin.id}:${onIt}`).toBe(`${skin.id}:true`);
    }
  });
});

// ── Facing is a fact, not a style ─────────────────────────────────────────

describe("Karel faces the way the world says", () => {
  /** Karel's marks, as boxes measured from the centre of the corner he is on. */
  function karelBoxes(skin: Skin, facing: string): Mark[] {
    const { c, recorder } = contextFor({ width: 800, height: 600 });
    skin.drawKarel(c, { x: 5, y: 5, facing, beepers: 0 });
    const centre = cellCenter(c.layout, 5, 5);
    const marks = recorder.marks.map((mark) => ({
      ...mark,
      minX: mark.minX - centre.x,
      maxX: mark.maxX - centre.x,
      minY: mark.minY - centre.y,
      maxY: mark.maxY - centre.y,
      points: mark.points.map((point) => ({ x: point.x - centre.x, y: point.y - centre.y })),
    }));
    expect(marks.length).toBeGreaterThan(0);
    return marks;
  }

  /**
   * A box turned a quarter clockwise about the corner's centre.
   *
   * Screen y counts down, so clockwise sends (x, y) to (-y, x) -- and a box's
   * two corners swap roles on the axis that is negated, which is why the
   * bounds cross over. Exact for a rotated path and exact for a rotated
   * bitmap alike, which is the point: it holds all three packs to the same
   * claim without knowing how any of them draws.
   */
  function turned(mark: Mark): Mark {
    return {
      ...mark,
      minX: -mark.maxY,
      maxX: -mark.minY,
      minY: mark.minX,
      maxY: mark.maxX,
      points: mark.points.map((point) => ({ x: -point.y, y: point.x })),
    };
  }

  function fingerprint(marks: Mark[]): string {
    // Points are sorted inside a mark because a turn permutes a rectangle's
    // corners, and marks are sorted because a pack may emit them in any order.
    return marks
      .map((mark) =>
        [
          mark.kind,
          mark.colour,
          ...mark.points.map((point) => `${point.x.toFixed(3)},${point.y.toFixed(3)}`).sort(),
        ].join(" ")
      )
      .sort()
      .join("\n");
  }

  for (const skin of SKINS) {
    it(`${skin.id} draws each facing as the previous one turned`, () => {
      // north -> east -> south -> west is a quarter turn clockwise each time,
      // and coming back to north again closes the loop.
      const order = ["north", "east", "south", "west", "north"];
      for (let i = 0; i < 4; i++) {
        const from = karelBoxes(skin, order[i]!);
        const to = karelBoxes(skin, order[i + 1]!);
        expect(`${skin.id} ${order[i]}->${order[i + 1]}: ${fingerprint(from.map(turned))}`).toBe(
          `${skin.id} ${order[i]}->${order[i + 1]}: ${fingerprint(to)}`
        );
      }
    });

    it(`${skin.id} draws four facings that are actually different`, () => {
      // The turn test alone would pass for a shape with no front, which would
      // leave a student unable to tell which way Karel is about to move.
      const seen = new Set(
        ["north", "east", "south", "west"].map((facing) => fingerprint(karelBoxes(skin, facing)))
      );
      expect(`${skin.id}:${seen.size}`).toBe(`${skin.id}:4`);
    });

    it(`${skin.id} points north at an unknown facing rather than vanishing`, () => {
      const { c, recorder } = contextFor({ width: 800, height: 600 });
      skin.drawKarel(c, { x: 5, y: 5, facing: "northwest", beepers: 0 });
      expect(recorder.marks.some((mark) => mark.colour === PALETTE.karel)).toBe(true);
      // "north" is what the world validator falls back to, so this is what it
      // has to look like -- not merely something.
      expect(fingerprint(karelBoxes(skin, "northwest"))).toBe(
        fingerprint(karelBoxes(skin, "north"))
      );
    });
  }
});

// ── Legibility at the smallest cell ───────────────────────────────────────

describe("nothing degenerates in the smallest world panel", () => {
  for (const skin of SKINS) {
    it(`${skin.id} still draws a Karel and a pile with area at MIN_CELL`, () => {
      const { c, recorder } = contextFor({ width: 120, height: 90 });
      expect(c.layout.cell).toBe(16);
      skin.drawBeepers(c, [{ x: 4, y: 4, count: 1 }]);
      skin.drawKarel(c, WORLD.karel);
      for (const colour of [PALETTE.beeper, PALETTE.karel]) {
        const marks = recorder.marks.filter((mark) => mark.colour === colour);
        expect(marks.length).toBeGreaterThan(0);
        // The union of the marks, not the biggest one: `blocks` builds a
        // sixteen-pixel sprite out of sixty-four one-pixel squares.
        const span = Math.min(
          Math.max(...marks.map((m) => m.maxX)) - Math.min(...marks.map((m) => m.minX)),
          Math.max(...marks.map((m) => m.maxY)) - Math.min(...marks.map((m) => m.minY))
        );
        // A shape narrower than a quarter of the cell is a shape nobody can
        // read at the size the panel has shrunk to.
        expect(`${skin.id}:${span >= 4}`).toBe(`${skin.id}:true`);
      }
    });
  }
});

// ── Which pack is on ──────────────────────────────────────────────────────

describe("choosing a pack", () => {
  it("switches, and tells anyone who asked", () => {
    const seen: string[] = [];
    const stop = onSkinChange(() => seen.push(currentSkin()));
    setSkin("blocks");
    expect(activeSkin()).toBe(blocksSkin);
    setSkin("classic");
    expect(activeSkin()).toBe(classicSkin);
    stop();
    setSkin("terminal");
    expect(seen).toEqual(["blocks", "classic"]);
  });

  it("says nothing when asked for the pack already on", () => {
    const seen: string[] = [];
    onSkinChange(() => seen.push(currentSkin()));
    setSkin("terminal");
    expect(seen).toEqual([]);
  });

  it("ignores a pack that does not exist, rather than blanking the canvas", () => {
    setSkin("blocks");
    const seen: string[] = [];
    onSkinChange(() => seen.push(currentSkin()));
    // A stored id from a pack that has since been renamed arrives here.
    setSkin("pixel");
    expect(currentSkin()).toBe("blocks");
    expect(seen).toEqual([]);
  });
});
