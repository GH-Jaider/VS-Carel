/**
 * Skin packs: what the world is drawn *as*.
 *
 * The renderer used to hold one opinion about shape — a dotted lattice, walls
 * as hairlines, beepers as circles, Karel as a triangle — welded to the
 * arithmetic that decides where those shapes go. This file is the opinion,
 * lifted out; `world.ts` keeps the arithmetic and the paint order.
 *
 * The split is drawn at exactly one place, and it is worth stating plainly:
 *
 *   · A pack chooses SHAPES and STROKE. It never chooses colour. Every fill
 *     and every stroke comes out of the `ThemeColors` it is handed, so the
 *     four palettes and the three packs multiply out to twelve combinations
 *     that all work, instead of three packs that each look right in one theme.
 *
 *   · A pack is handed its geometry — `center`, `corner`, `segment` — rather
 *     than deriving it. That is not a convenience: the hit test in `world.ts`
 *     is the inverse of that same arithmetic, and a pack that computed its own
 *     could drift from it. Shapes may differ between packs; where a click
 *     lands may not.
 *
 * Adding a pack means adding an entry to `SKINS` and an object that satisfies
 * `Skin`. Nothing else in the app needs to know it exists.
 */

import type { BeeperStack, KarelMap, Wall } from "@karel/core";
import type { ThemeColors } from "../contracts.js";
import { onLocaleChange, t } from "../i18n.js";
import { colors, onThemeChange } from "./theme.js";
import type { Layout, Point, Segment } from "./world.js";

/**
 * The one face the whole project uses, canvas included. Lives here rather than
 * in `world.ts` because every string drawn on the world is now a pack's doing.
 */
export const MONO = '"JetBrains Mono", ui-monospace, monospace';

/**
 * Karel's glyph points north at rest; each facing is a rotation of it.
 *
 * Shared because the mapping from a compass word to an angle is a fact about
 * the world, not a stylistic choice — a pack that disagreed about which way
 * "east" is would be a bug, not a look.
 */
export const ROTATIONS: Record<string, number> = {
  north: 0,
  west: -Math.PI / 2,
  south: Math.PI,
  east: Math.PI / 2,
};

const FACINGS = ["north", "east", "south", "west"] as const;
export type Facing = (typeof FACINGS)[number];

/** Anything unfamiliar points north, which is what the world validator defaults to. */
function facingOf(facing: string): Facing {
  return (FACINGS as readonly string[]).includes(facing) ? (facing as Facing) : "north";
}

// ── The contract ──────────────────────────────────────────────────────────

/**
 * Everything a pack is allowed to know while it draws one frame.
 *
 * Deliberately narrow. There is no world here beyond what each call is given,
 * no session, no DOM: a pack can only put marks on a context, at coordinates
 * somebody else worked out, in colours somebody else chose.
 */
export interface SkinContext {
  readonly ctx: CanvasRenderingContext2D;
  readonly layout: Layout;
  readonly palette: ThemeColors;
  /**
   * The widest a wall may be drawn, in CSS pixels.
   *
   * A wall between two corners has half a cell of room on either side and
   * could be any thickness at all; this bound exists for the rim, which is
   * drawn on the edge of the bitmap. Anything thicker than this cannot be
   * made to fit there however it is placed.
   */
  readonly maxWallWidth: number;
  /**
   * How much of the rim's thickness fits *outside* the grid.
   *
   * The layout reserves this much on every side and not a pixel more, so a
   * pack that wants a heavier rim than the reserve has to grow it inward.
   * `rimRect` does that arithmetic; no pack should be doing it by hand.
   */
  readonly rimRoom: number;
  /** The centre of cell (x, y) in canvas pixels. */
  center(x: number, y: number): Point;
  /** The top-left corner of cell (x, y) in canvas pixels. */
  corner(x: number, y: number): Point;
  /** The one-cell line a wall is drawn as. */
  segment(wall: Wall): Segment;
}

/** What a pack draws into its own swatch in the picker. */
export interface SwatchContext {
  readonly ctx: CanvasRenderingContext2D;
  readonly palette: ThemeColors;
  readonly width: number;
  readonly height: number;
}

/**
 * One pack, complete.
 *
 * Every method is required. A pack that left one out would fall back to
 * another pack's hand for that element, and the mixture always looks like a
 * mistake rather than like a third style.
 */
export interface Skin {
  readonly id: string;
  /** The pack's own name. Not translated, the way a theme's name is not. */
  readonly label: string;
  /** The ground the world sits on. Called first, and clears the frame. */
  drawBackground(c: SkinContext): void;
  /** The 1-based numbers down the left and along the bottom. */
  drawAxes(c: SkinContext): void;
  /** The interior lattice. The rim is a wall and belongs to `drawWalls`. */
  drawGrid(c: SkinContext): void;
  /** Every wall in the map, plus the rim, which is walled by definition. */
  drawWalls(c: SkinContext, walls: readonly Wall[]): void;
  /** Every pile with something in it, count included. */
  drawBeepers(c: SkinContext, beepers: readonly BeeperStack[]): void;
  drawKarel(c: SkinContext, karel: KarelMap["karel"]): void;
  /** The cell under the pointer, in edit mode. */
  drawCursor(c: SkinContext, cell: Point): void;
  /** The wall a click would place — an intention, not a thing already there. */
  drawEdgeCursor(c: SkinContext, wall: Wall): void;
  /** The pack's own miniature, for the picker. */
  drawSwatch(c: SwatchContext): void;
}

// ── Shared drawing helpers ────────────────────────────────────────────────

/**
 * The largest size in the type scale at which `text` still fits `maxWidth`.
 *
 * A pile of 12 has to stay readable inside the same shape that holds a 1, and
 * shrinking the shape to suit the widest possible count would make every
 * ordinary pile tiny. The type shrinks instead.
 */
export function fitLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  preferred: number
): number {
  const scale = [9.5, 10, 10.5, 11, 11.5, 12, 12.5];
  let chosen = scale[0]!;
  for (const size of scale) {
    if (size > preferred) {
      break;
    }
    ctx.font = `${size}px ${MONO}`;
    if (ctx.measureText(text).width > maxWidth) {
      break;
    }
    chosen = size;
  }
  return chosen;
}

/** The axis numbers, in whichever weight a pack asks for. */
function drawAxisNumbers(c: SkinContext, weight: string): void {
  const { ctx, layout, palette } = c;
  const { width, height } = layout.world;
  if (layout.axisMargin <= 0) {
    return;
  }
  ctx.fillStyle = palette.label;
  ctx.font = `${weight} 10px ${MONO}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let x = 1; x <= width; x++) {
    ctx.fillText(String(x), c.center(x, 1).x, layout.canvasHeight - layout.axisMargin / 2);
  }
  for (let y = 1; y <= height; y++) {
    ctx.fillText(String(y), layout.axisMargin / 2, c.center(1, y).y);
  }
}

/** The rectangle the grid itself occupies, in canvas pixels. */
function gridBox(layout: Layout): { x: number; y: number; width: number; height: number } {
  return {
    x: layout.originX,
    y: layout.originY,
    width: layout.world.width * layout.cell,
    height: layout.world.height * layout.cell,
  };
}

/**
 * The rectangle to *stroke* for a rim `width` thick, so that it lands inside
 * the bitmap however heavy it is.
 *
 * The reserve outside the grid is fixed by the layout. A rim no thicker than
 * the reserve sits entirely in it, straddling the grid's edge exactly as a
 * one-cell wall straddles a boundary. A heavier rim pins its outer face to
 * the edge of the reserve and takes the difference out of the grid, which
 * costs a few pixels of the outermost cells and never costs a mark that falls
 * off the canvas.
 */
export function rimRect(
  c: SkinContext,
  width: number
): { x: number; y: number; width: number; height: number } {
  const box = gridBox(c.layout);
  const outside = Math.min(width, c.rimRoom);
  return {
    x: box.x - outside + width / 2,
    y: box.y - outside + width / 2,
    width: box.width + outside * 2 - width,
    height: box.height + outside * 2 - width,
  };
}

/** Fill the whole bitmap with the theme's canvas colour. */
function clear(c: SkinContext): void {
  c.ctx.fillStyle = c.palette.background;
  c.ctx.fillRect(0, 0, c.layout.canvasWidth, c.layout.canvasHeight);
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

// ── terminal ──────────────────────────────────────────────────────────────

/**
 * The house style, and the default: a TUI drawn with a one-pixel pen.
 *
 * This is the renderer as it already was, moved rather than redesigned. It
 * earns the default slot twice over — it is the look the rest of the page is
 * built to match, and it is the one that has been in front of the world's
 * geometry long enough to be trusted. Hairlines, flat fills, no outlines that
 * are not structural: a cell either has a colour or it does not.
 */
const TERMINAL_WALL = 4;

export const terminalSkin: Skin = {
  id: "terminal",
  label: "terminal",

  drawBackground(c) {
    clear(c);
  },

  drawAxes(c) {
    drawAxisNumbers(c, "400");
  },

  drawGrid(c) {
    const { ctx, layout, palette } = c;
    const { cell, originX, originY, world } = layout;
    ctx.save();
    ctx.strokeStyle = palette.grid;
    ctx.lineWidth = 1;
    ctx.setLineDash([1, 3]);
    ctx.beginPath();
    // The half-pixel keeps a 1px line on a pixel instead of across two.
    for (let x = 1; x < world.width; x++) {
      const px = Math.round(originX + x * cell) + 0.5;
      ctx.moveTo(px, originY);
      ctx.lineTo(px, originY + world.height * cell);
    }
    for (let y = 1; y < world.height; y++) {
      const py = Math.round(originY + y * cell) + 0.5;
      ctx.moveTo(originX, py);
      ctx.lineTo(originX + world.width * cell, py);
    }
    ctx.stroke();
    ctx.restore();
  },

  drawWalls(c, walls) {
    const { ctx, palette } = c;
    const width = Math.min(TERMINAL_WALL, c.maxWallWidth);
    ctx.save();
    ctx.strokeStyle = palette.wall;
    ctx.lineWidth = width;
    ctx.lineCap = "square";
    ctx.beginPath();
    for (const wall of walls) {
      const segment = c.segment(wall);
      ctx.moveTo(segment.x1, segment.y1);
      ctx.lineTo(segment.x2, segment.y2);
    }
    ctx.stroke();

    const rim = rimRect(c, width);
    ctx.strokeRect(rim.x, rim.y, rim.width, rim.height);
    ctx.restore();
  },

  drawBeepers(c, beepers) {
    const { ctx, layout, palette } = c;
    const radius = layout.cell * 0.28;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const beeper of beepers) {
      if (beeper.count < 1) {
        continue;
      }
      const center = c.center(beeper.x, beeper.y);
      ctx.fillStyle = palette.beeper;
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
      ctx.fill();

      // The count is the point of most exercises, so it is drawn even for one.
      const label = String(beeper.count);
      ctx.fillStyle = palette.beeperLabel;
      ctx.font = `${fitLabel(ctx, label, radius * 1.7, layout.cell * 0.34)}px ${MONO}`;
      ctx.fillText(label, center.x, center.y);
    }
    ctx.restore();
  },

  drawKarel(c, karel) {
    const { ctx, layout, palette } = c;
    const center = c.center(karel.x, karel.y);
    const size = layout.cell * 0.7;

    ctx.save();
    ctx.translate(center.x, center.y);
    ctx.rotate(ROTATIONS[karel.facing] ?? 0);

    ctx.fillStyle = palette.karel;
    ctx.beginPath();
    ctx.moveTo(0, -size / 2);
    ctx.lineTo(-size / 3, size / 3);
    ctx.lineTo(size / 3, size / 3);
    ctx.closePath();
    ctx.fill();

    // Outlined in the ground colour so Karel stays legible standing on a pile.
    ctx.strokeStyle = palette.background;
    ctx.lineWidth = 2;
    ctx.lineJoin = "miter";
    ctx.stroke();
    ctx.restore();
  },

  drawCursor(c, cell) {
    const { ctx, layout, palette } = c;
    const corner = c.corner(cell.x, cell.y);
    ctx.fillStyle = palette.cursor;
    ctx.fillRect(corner.x, corner.y, layout.cell, layout.cell);
  },

  drawEdgeCursor(c, wall) {
    const { ctx, palette } = c;
    const segment = c.segment(wall);
    ctx.save();
    ctx.strokeStyle = palette.cursor;
    ctx.lineWidth = Math.min(TERMINAL_WALL + 2, c.maxWallWidth);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(segment.x1, segment.y1);
    ctx.lineTo(segment.x2, segment.y2);
    ctx.stroke();
    ctx.restore();
  },

  drawSwatch({ ctx, palette, width, height }) {
    ctx.fillStyle = palette.background;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = palette.wall;
    ctx.lineWidth = 1;
    ctx.strokeRect(1.5, 1.5, width - 3, height - 3);

    ctx.strokeStyle = palette.grid;
    ctx.setLineDash([1, 2]);
    ctx.beginPath();
    ctx.moveTo(Math.round(width / 2) + 0.5, 2);
    ctx.lineTo(Math.round(width / 2) + 0.5, height - 2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = palette.karel;
    ctx.beginPath();
    ctx.moveTo(width * 0.26, height * 0.24);
    ctx.lineTo(width * 0.14, height * 0.72);
    ctx.lineTo(width * 0.38, height * 0.72);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = palette.beeper;
    ctx.beginPath();
    ctx.arc(width * 0.74, height * 0.5, Math.min(width, height) * 0.19, 0, Math.PI * 2);
    ctx.fill();
  },
};

// ── blocks ────────────────────────────────────────────────────────────────

/**
 * Pixel art, and honest about it.
 *
 * Everything is a multiple of one derived unit — the pack's "pixel" — and
 * every coordinate is rounded to a whole CSS pixel before it is drawn, so
 * nothing is ever softened by antialiasing. Karel is a sprite off an 8x8
 * bitmap rather than a rotated path, because rotating pixel art is how you
 * turn pixel art into mud: the four facings are four rotations of the *mask*,
 * each still square to the screen.
 *
 * What that unit builds: a lattice of dashed rules, walls as solid blocks
 * that own their edge from one corner to the other, and piles that are
 * literally stacks of chips. The rim is drawn out of the same block as an
 * interior wall and piered at every joint between two of them, because a rim
 * *is* a wall — the one the hit test refuses to let anybody toggle — and a
 * pack that drew it as a band around the outside was saying otherwise.
 */

/** The sprite is this many pack-pixels on a side. */
const SPRITE = 8;

/**
 * The sprite plus the ring of ground around it.
 *
 * Karel wears a one-pixel halo so he still reads while standing on a pile,
 * and a halo is ground colour: whatever it covers, it erases. So the footprint
 * that has to stay clear of the walls is ten pack-pixels and not eight, and
 * ten is what `unit` sizes against.
 *
 * Sizing against `SPRITE` alone is what broke this pack. At the largest cell
 * the sprite came to 78% of the cell, the halo took it to 97%, and the pixel
 * left over on each side was less than the four a wall reaches in from the
 * boundary — so a Karel standing anywhere along the edge of the world rubbed
 * a notch out of the rim behind him, measured at 294 pixels of ground on the
 * wall in a six-by-four world.
 */
const SPRITE_BOX = SPRITE + 2;

/**
 * Karel facing north.
 *
 * `#` is Karel, `o` is a hole cut clean through him to the ground, `.` is
 * outside him altogether.
 *
 * The hull is nearly the whole square, and that is deliberate twice over.
 *
 * It is what makes the turn work: anything that only reads with one
 * particular edge downward — the pair of feet the first draft had — becomes
 * two spikes out of Karel's flank a quarter turn later, which is what made
 * the east-facing sprite look like a squashed insect. A body that fills its
 * box turns into itself.
 *
 * And it is what makes standing on a pile read. The halo below is a dilation
 * of this shape, so whatever the hull does not reach, the chips underneath
 * show through; a rounder Karel left the corners of the pile sticking out as
 * loose specks of beeper colour, which looks like a fault rather than like a
 * robot on a heap of something.
 *
 * Which way he faces is told three times, and all three survive the turn: the
 * prow tapers four, six, eight across the first three rows; the visor sits
 * behind the prow; and the stern carries two exhaust notches. The visor is a
 * hole rather than a second colour, because one ink and the ground is the
 * whole palette a pack is allowed. Holes need no handling in the fill — the
 * halo covers them, since each touches Karel on every side.
 */
const KAREL_SPRITE = [
  "..####..",
  ".######.",
  "##oooo##",
  "########",
  "########",
  "########",
  "########",
  "##.##.##",
] as const;

type Mask = boolean[][];

function toMask(rows: readonly string[]): Mask {
  return rows.map((row) => [...row].map((glyph) => glyph === "#"));
}

/** Quarter turn clockwise. `dest[r][c]` is the pixel that lands there. */
function rotateCW(mask: Mask): Mask {
  const n = mask.length;
  return mask.map((_, r) => mask.map((_row, c) => mask[n - 1 - c]![r]!));
}

/**
 * The four facings, rotated once at module load.
 *
 * A rotation is cheap, but it is also the same four answers every frame, and
 * a table read is cheaper than a rotation sixty times a second.
 */
const KAREL_MASKS: Record<Facing, Mask> = (() => {
  const north = toMask(KAREL_SPRITE);
  const east = rotateCW(north);
  const south = rotateCW(east);
  const west = rotateCW(south);
  return { north, east, south, west };
})();

/**
 * The pack's pixel: the largest whole CSS pixel that keeps Karel *and his
 * halo* inside seven tenths of a cell.
 *
 * Seven tenths is not a taste: what is left over — three twentieths of a cell
 * on each side — is the clearance every other mark in this pack inherits, and
 * it has to beat the four pixels a wall drawn at `maxWallWidth` reaches in
 * from the boundary. It does, at every cell size between the layout's two
 * clamps, by a pixel and a half at the tightest. Never below one, or the
 * sprite vanishes.
 */
function unit(cell: number): number {
  return Math.max(1, Math.floor((cell * 0.7) / SPRITE_BOX));
}

function blockWallWidth(c: SkinContext): number {
  return clamp(unit(c.layout.cell) * 2, 3, c.maxWallWidth);
}

/**
 * How far past each end of its edge a wall block runs.
 *
 * A block drawn between exactly its two corners stops short of them, and
 * where two walls meet — or where an interior wall runs into the rim — that
 * leaves a square hole at the joint. Half a width past each end fills it, and
 * half a width is also the most that can be spent: `maxWallWidth` is twice
 * the reserve the layout keeps outside the grid, so a block on the world's
 * edge lands on the last pixel of the bitmap and never past it.
 */
function jointReach(c: SkinContext, width: number): number {
  return Math.min(width / 2, c.rimRoom);
}

/** One wall block, on whole pixels, with the joints at both ends filled in. */
function wallBar(c: SkinContext, segment: Segment, width: number): void {
  const { ctx } = c;
  const half = width / 2;
  const reach = jointReach(c, width);
  if (segment.y1 === segment.y2) {
    const left = Math.round(segment.x1 - reach);
    ctx.fillRect(left, Math.round(segment.y1 - half), Math.round(segment.x2 + reach) - left, width);
  } else {
    const top = Math.round(segment.y1 - reach);
    ctx.fillRect(Math.round(segment.x1 - half), top, width, Math.round(segment.y2 + reach) - top);
  }
}

export const blocksSkin: Skin = {
  id: "blocks",
  label: "blocks",

  drawBackground(c) {
    clear(c);
  },

  drawAxes(c) {
    // Bold, because a hairline numeral beside a chunky world looks like a
    // different program's output.
    drawAxisNumbers(c, "700");
  },

  drawGrid(c) {
    const { ctx, layout, palette } = c;
    const { cell, originX, originY, world } = layout;
    // A rule is dashed, the dash as long as the pen is wide. What was here
    // before was a single dot at each interior crossing, which in a
    // six-by-three world is ten dots floating in the middle of an empty
    // rectangle: it read as dirt on the screen rather than as a grid, because
    // nothing joined the dots up.
    //
    // The pen is a fraction of the pack-pixel rather than the whole of it.
    // A rule runs down exactly the line a wall runs down, and the paint order
    // puts the grid over the edge cursor -- so a rule as wide as a wall does
    // not sit beside the amber bar that says "a wall would go here", it sits
    // on top of it and cuts it into pieces.
    const px = unit(cell);
    const pen = Math.max(1, Math.round(px * 0.6));
    // `off` is what puts the pen on whole pixels: an odd pen has to be centred
    // on a half-pixel to cover whole ones, an even pen on a whole one.
    const off = Math.floor(pen / 2);
    const rule = (v: number): number => Math.round(v) - off + pen / 2;
    const right = originX + world.width * cell;
    const bottom = originY + world.height * cell;

    ctx.save();
    ctx.strokeStyle = palette.grid;
    ctx.fillStyle = palette.grid;
    ctx.lineWidth = pen;
    ctx.lineCap = "butt";
    ctx.setLineDash([pen, pen]);
    ctx.beginPath();
    for (let x = 1; x < world.width; x++) {
      const at = rule(originX + x * cell);
      ctx.moveTo(at, originY);
      ctx.lineTo(at, bottom);
    }
    for (let y = 1; y < world.height; y++) {
      const at = rule(originY + y * cell);
      ctx.moveTo(originX, at);
      ctx.lineTo(right, at);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // A crossing falls wherever the dashes happen to be, so it is filled in by
    // hand: the lattice would otherwise be at its weakest exactly where it
    // should be clearest, on the corners of the cells.
    for (let x = 1; x < world.width; x++) {
      for (let y = 1; y < world.height; y++) {
        ctx.fillRect(
          Math.round(originX + x * cell) - off,
          Math.round(originY + y * cell) - off,
          pen,
          pen
        );
      }
    }
    ctx.restore();
  },

  drawWalls(c, walls) {
    const { ctx, layout, palette } = c;
    const width = blockWallWidth(c);
    ctx.fillStyle = palette.wall;
    for (const wall of walls) {
      wallBar(c, c.segment(wall), width);
    }

    // The rim, as four blocks rather than a stroked rectangle: a stroke would
    // land on half-pixels at odd widths, which is the one thing this pack
    // cannot do. `rimRect` gives the centre line; the blocks are laid on it,
    // and they overlap at the four corners, which is what squares them off.
    const rim = rimRect(c, width);
    const left = Math.round(rim.x - width / 2);
    const top = Math.round(rim.y - width / 2);
    const right = Math.round(rim.x + rim.width - width / 2);
    const bottom = Math.round(rim.y + rim.height - width / 2);
    ctx.fillRect(left, top, right - left + width, width);
    ctx.fillRect(left, bottom, right - left + width, width);
    ctx.fillRect(left, top, width, bottom - top + width);
    ctx.fillRect(right, top, width, bottom - top + width);

    // A pier wherever two of the rim's own blocks meet, set against the inner
    // face. This is the difference between a wall and a picture frame: the
    // edge of the world is walled cell by cell, exactly as the inside is, and
    // these are the joints. Inward, because the reserve outside the grid is
    // already spent on the rim; and in the wall's own colour, because a seam
    // cut in the ground colour would be a hole in a wall.
    const deep = unit(layout.cell);
    if (deep < 2) {
      // Below two pixels a pier is a speck, and a speck on a three-pixel rim
      // is noise. The rim carries itself at that size.
      return;
    }
    // Twice as long as it is deep: a square nub at this size disappears into
    // the band it is attached to, and a joint nobody can see is not a joint.
    const along = deep * 2;
    for (let x = 1; x < layout.world.width; x++) {
      const at = Math.round(rim.x + (x * rim.width) / layout.world.width - along / 2);
      ctx.fillRect(at, top + width, along, deep);
      ctx.fillRect(at, bottom - deep, along, deep);
    }
    for (let y = 1; y < layout.world.height; y++) {
      const at = Math.round(rim.y + (y * rim.height) / layout.world.height - along / 2);
      ctx.fillRect(left + width, at, deep, along);
      ctx.fillRect(right - deep, at, deep, along);
    }
  },

  drawBeepers(c, beepers) {
    const { ctx, layout, palette } = c;
    const px = unit(layout.cell);
    // A whole number of pack-pixels, and small enough that the deepest pile a
    // pack draws -- three chips, plus the halo around them -- still fits
    // inside its own corner. A pile that overhung its square would sit on the
    // wall beside it, and at the edge of the world it would sit off the
    // canvas. `cell * 0.52` clears that with room to spare at every cell size
    // between the two clamps; the test that walks the bitmap keeps it honest.
    const side = Math.max(4, Math.floor((layout.cell * 0.52) / px) * px);
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const beeper of beepers) {
      if (beeper.count < 1) {
        continue;
      }
      const center = c.center(beeper.x, beeper.y);
      // A pile is drawn as a pile: up to three chips stepped back and up, the
      // front one carrying the count. Past three the numeral does the work.
      //
      // It is the whole stack that sits on the corner, not the front chip --
      // which is both what a pile of things looks like and what buys the chips
      // their size, since a stack that leaned up and to the right of the
      // corner would need half again as much room on that side.
      const layers = Math.min(beeper.count, 3);
      const span = (layers - 1) * px;
      const left = Math.round(center.x - (side + span) / 2);
      const top = Math.round(center.y - (side + span) / 2);

      // The halo goes down once, around the whole stack. Drawing one per chip
      // was the obvious way to write this and it is wrong: the front chip's
      // halo is the last thing painted and rubs out the chips behind it, so
      // every pile in the world looked like a pile of one.
      ctx.fillStyle = palette.background;
      ctx.fillRect(left - px, top - px, side + span + px * 2, side + span + px * 2);
      // Every chip but the hindmost cuts a seam out of the chip behind it
      // along the two edges they share, so three chips read as three things
      // rather than as one stepped blob. The seam is a hairline rather than a
      // pack-pixel: a pack-pixel is the width of the whole reveal, so it ate
      // the very step it was there to show. Below three pixels to a step
      // there is nothing left to separate, and it is dropped.
      const seam = px >= 3 ? 1 : 0;
      for (let i = layers - 1; i >= 0; i--) {
        const x = left + i * px;
        const y = top + span - i * px;
        if (i < layers - 1 && seam > 0) {
          ctx.fillStyle = palette.background;
          ctx.fillRect(x, y - seam, side + seam, seam);
          ctx.fillRect(x + side, y - seam, seam, side + seam);
        }
        ctx.fillStyle = palette.beeper;
        ctx.fillRect(x, y, side, side);
      }

      // On the front chip, which is the one the reader is looking at.
      const label = String(beeper.count);
      ctx.fillStyle = palette.beeperLabel;
      ctx.font = `700 ${fitLabel(ctx, label, side * 0.86, layout.cell * 0.34)}px ${MONO}`;
      ctx.fillText(label, left + side / 2, top + span + side / 2);
    }
    ctx.restore();
  },

  drawKarel(c, karel) {
    const { ctx, layout, palette } = c;
    const px = unit(layout.cell);
    const mask = KAREL_MASKS[facingOf(karel.facing)];
    const center = c.center(karel.x, karel.y);
    const left = Math.round(center.x - (SPRITE * px) / 2);
    const top = Math.round(center.y - (SPRITE * px) / 2);

    /** Is any of the eight neighbours of (r, s) lit? */
    const touching = (r: number, s: number): boolean => {
      for (let dr = -1; dr <= 1; dr++) {
        for (let ds = -1; ds <= 1; ds++) {
          if (mask[r + dr]?.[s + ds]) {
            return true;
          }
        }
      }
      return false;
    };

    // The halo: one pack-pixel of ground colour around the sprite, so Karel
    // reads as standing on top of a pile of beepers rather than as a shape cut
    // out of one. It is a dilation of the mask rather than a stroked outline,
    // which keeps it square to the pixel grid; and it runs one row and column
    // outside the sprite, because the sprite fills its box to the edge on all
    // four sides and an edge pixel needs a halo too. That ring is why `unit`
    // sizes against `SPRITE_BOX`: this loop paints ground, and ground painted
    // on a wall is a hole in the wall.
    ctx.fillStyle = palette.background;
    for (let r = -1; r <= SPRITE; r++) {
      for (let s = -1; s <= SPRITE; s++) {
        if (!mask[r]?.[s] && touching(r, s)) {
          ctx.fillRect(left + s * px, top + r * px, px, px);
        }
      }
    }

    ctx.fillStyle = palette.karel;
    for (let r = 0; r < SPRITE; r++) {
      for (let s = 0; s < SPRITE; s++) {
        if (mask[r]![s]!) {
          ctx.fillRect(left + s * px, top + r * px, px, px);
        }
      }
    }
  },

  drawCursor(c, cell) {
    const { ctx, layout, palette } = c;
    const px = unit(layout.cell);
    const corner = c.corner(cell.x, cell.y);
    const x = Math.round(corner.x);
    const y = Math.round(corner.y);
    const size = Math.round(layout.cell);
    ctx.fillStyle = palette.cursor;
    ctx.fillRect(x, y, size, size);
    // Corners knocked out: the low-resolution way to round something.
    ctx.fillStyle = palette.background;
    ctx.fillRect(x, y, px, px);
    ctx.fillRect(x + size - px, y, px, px);
    ctx.fillRect(x, y + size - px, px, px);
    ctx.fillRect(x + size - px, y + size - px, px, px);
  },

  drawEdgeCursor(c, wall) {
    const { ctx, palette } = c;
    ctx.fillStyle = palette.cursor;
    wallBar(c, c.segment(wall), clamp(blockWallWidth(c) + 2, 4, c.maxWallWidth));
  },

  drawSwatch({ ctx, palette, width, height }) {
    ctx.fillStyle = palette.background;
    ctx.fillRect(0, 0, width, height);

    // Two pixels rather than three: at three the rim ate a fifth of a swatch
    // that is only sixteen pixels tall, and the miniature has to show what is
    // inside the world, not how heavy its edge is.
    const bar = 2;
    ctx.fillStyle = palette.wall;
    ctx.fillRect(0, 0, width, bar);
    ctx.fillRect(0, height - bar, width, bar);
    ctx.fillRect(0, 0, bar, height);
    ctx.fillRect(width - bar, 0, bar, height);
    // The piers, at the one joint a swatch this small has room to show.
    ctx.fillRect(Math.round(width / 2) - 1, bar, 1, 1);
    ctx.fillRect(Math.round(width / 2) - 1, height - bar - 1, 1, 1);

    // The dashed rule, in the pack-pixel the swatch can afford, which is one.
    ctx.fillStyle = palette.grid;
    for (let y = bar + 1; y < height - bar; y += 2) {
      ctx.fillRect(Math.round(width / 2) - 1, y, 1, 1);
    }

    // Karel at one pixel per sprite cell, which is what the swatch has room
    // for, and reads as the same creature the world draws.
    const px = 1;
    const left = bar + 1;
    const top = Math.round(height / 2 - (SPRITE * px) / 2);
    ctx.fillStyle = palette.karel;
    const mask = KAREL_MASKS.east;
    for (let r = 0; r < SPRITE; r++) {
      for (let s = 0; s < SPRITE; s++) {
        if (mask[r]![s]!) {
          ctx.fillRect(left + s * px, top + r * px, px, px);
        }
      }
    }

    ctx.fillStyle = palette.beeper;
    const side = 4;
    const bx = width - bar - 2 - side;
    const by = Math.round(height / 2 - side / 2);
    ctx.fillRect(bx, by + 1, side, side);
    ctx.fillRect(bx + 1, by - 1, side, side);
  },
};

// ── classic ───────────────────────────────────────────────────────────────

/**
 * The look out of the Karel book: a drafted sheet, a hollow arrowhead, walls
 * as heavy strokes with a post at each end.
 *
 * The one hard problem here is the paper. The book's world sits on white, and
 * a pack that fills the canvas with white would be unreadable in three of the
 * four themes and would also break the chrome — the panel's title chips carry
 * `--bg` and straddle the canvas's border, so a canvas that is not the page's
 * background shows them up as patches.
 *
 * So the sheet is neither white nor a colour of this pack's own. It is the
 * theme's own background lifted a few percent toward the theme's own ink, and
 * it is confined to the rectangle inside the rim. On a dark palette that
 * reads as a page catching the light; on `paper` it reads as a sheet laid on
 * a desk. Outside the rim the canvas stays exactly the page colour, so the
 * chrome is none the wiser.
 */
const SHEET_ALPHA = 0.075;

/** Paint the current path as the sheet: ground colour, then the ink wash. */
function fillAsSheet(ctx: CanvasRenderingContext2D, palette: ThemeColors): void {
  ctx.fillStyle = palette.background;
  ctx.fill();
  ctx.save();
  ctx.globalAlpha = SHEET_ALPHA;
  ctx.fillStyle = palette.wall;
  ctx.fill();
  ctx.restore();
}

/**
 * Heavy, but not as heavy as it could be.
 *
 * The upper bound is six rather than `maxWallWidth`, and that is a shape
 * decision rather than a safety one: the post at each end is drawn at 0.62 of
 * the width, and at anything heavier the post would be no bigger than the
 * round cap it sits on -- the finish would stop reading as a finish.
 */
function classicWallWidth(c: SkinContext): number {
  return clamp(Math.round(c.layout.cell * 0.14), 3, Math.min(6, c.maxWallWidth));
}

export const classicSkin: Skin = {
  id: "classic",
  label: "classic",

  drawBackground(c) {
    clear(c);
    const box = gridBox(c.layout);
    c.ctx.beginPath();
    c.ctx.rect(box.x, box.y, box.width, box.height);
    fillAsSheet(c.ctx, c.palette);
  },

  drawAxes(c) {
    drawAxisNumbers(c, "500");
  },

  drawGrid(c) {
    const { ctx, layout, palette } = c;
    const { cell, originX, originY, world } = layout;
    // Solid hairlines, not dashes: this is drafting paper, and a ruled sheet
    // is ruled all the way across.
    ctx.save();
    ctx.strokeStyle = palette.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 1; x < world.width; x++) {
      const px = Math.round(originX + x * cell) + 0.5;
      ctx.moveTo(px, originY);
      ctx.lineTo(px, originY + world.height * cell);
    }
    for (let y = 1; y < world.height; y++) {
      const py = Math.round(originY + y * cell) + 0.5;
      ctx.moveTo(originX, py);
      ctx.lineTo(originX + world.width * cell, py);
    }
    ctx.stroke();

    // A cross at every intersection, because an intersection *is* a corner of
    // the world and the book names them: street 3 and avenue 5 meet here.
    //
    // Drawn in the axis ink rather than the grid's own, and this is the one
    // place the pack comes close to choosing a colour. It still does not --
    // `label` is a theme colour, chosen by the theme -- but the reason for
    // reaching for that one is worth writing down: a cross in the grid colour
    // sits exactly on top of two lines already drawn in the grid colour, and
    // is therefore invisible. The numbers along the axes are drawn in `label`
    // and mark the same corners, so the crosses are the same ink as the
    // numbers that name them.
    // Only while there is room for them. In a forty-by-thirty world the cell
    // clamps to its floor, and a cross at every one of eleven hundred
    // intersections stops being a mark on the paper and becomes the paper: the
    // lattice out-shouts the diamonds it is supposed to sit behind. Below this
    // the ruled lines carry the grid on their own.
    if (cell < 30) {
      ctx.restore();
      return;
    }
    const arm = Math.max(2, Math.round(cell * 0.07));
    ctx.strokeStyle = palette.label;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 1; x < world.width; x++) {
      for (let y = 1; y < world.height; y++) {
        const px = Math.round(originX + x * cell) + 0.5;
        const py = Math.round(originY + y * cell) + 0.5;
        ctx.moveTo(px - arm, py);
        ctx.lineTo(px + arm, py);
        ctx.moveTo(px, py - arm);
        ctx.lineTo(px, py + arm);
      }
    }
    ctx.stroke();
    ctx.restore();
  },

  drawWalls(c, walls) {
    const { ctx, palette } = c;
    const width = classicWallWidth(c);
    ctx.save();
    ctx.strokeStyle = palette.wall;
    ctx.fillStyle = palette.wall;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (const wall of walls) {
      const segment = c.segment(wall);
      ctx.moveTo(segment.x1, segment.y1);
      ctx.lineTo(segment.x2, segment.y2);
    }
    ctx.stroke();

    // The finish: a post at each end of every wall, so a segment reads as a
    // built thing with two ends rather than as a line that stops.
    const post = width * 0.62;
    ctx.beginPath();
    for (const wall of walls) {
      const segment = c.segment(wall);
      ctx.moveTo(segment.x1 + post, segment.y1);
      ctx.arc(segment.x1, segment.y1, post, 0, Math.PI * 2);
      ctx.moveTo(segment.x2 + post, segment.y2);
      ctx.arc(segment.x2, segment.y2, post, 0, Math.PI * 2);
    }
    ctx.fill();

    const rim = rimRect(c, width);
    ctx.strokeRect(rim.x, rim.y, rim.width, rim.height);
    ctx.restore();
  },

  drawBeepers(c, beepers) {
    const { ctx, layout, palette } = c;
    const reach = layout.cell * 0.34;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "miter";
    for (const beeper of beepers) {
      if (beeper.count < 1) {
        continue;
      }
      const center = c.center(beeper.x, beeper.y);
      ctx.beginPath();
      ctx.moveTo(center.x, center.y - reach);
      ctx.lineTo(center.x + reach, center.y);
      ctx.lineTo(center.x, center.y + reach);
      ctx.lineTo(center.x - reach, center.y);
      ctx.closePath();
      ctx.fillStyle = palette.beeper;
      ctx.fill();
      // The diamond gets the same ground-coloured outline Karel has, so two
      // piles on neighbouring corners never merge into one lozenge.
      ctx.strokeStyle = palette.background;
      ctx.lineWidth = 1;
      ctx.stroke();

      // The label sits on the diamond's widest chord, which is twice its
      // reach -- wider than the circle another pack would have drawn. What is
      // tight is the height, since a diamond narrows away from that line, so
      // the width it is measured against is discounted rather than doubled.
      const label = String(beeper.count);
      ctx.fillStyle = palette.beeperLabel;
      ctx.font = `${fitLabel(ctx, label, reach * 1.5, layout.cell * 0.34)}px ${MONO}`;
      ctx.fillText(label, center.x, center.y);
    }
    ctx.restore();
  },

  drawKarel(c, karel) {
    const { ctx, layout, palette } = c;
    const center = c.center(karel.x, karel.y);
    const size = layout.cell * 0.76;
    const stroke = clamp(layout.cell * 0.075, 1.5, 3.5);

    ctx.save();
    ctx.translate(center.x, center.y);
    ctx.rotate(ROTATIONS[karel.facing] ?? 0);

    // A dart: apex forward, two barbs back, notched between them. Hollow, as
    // the book draws him.
    //
    // What is filled is the triangle *without* the notch, and only then is the
    // notched outline drawn over it. Filling the dart itself left the notch
    // transparent, and a beeper on the same corner showed through the cavity
    // as a wedge of colour inside Karel -- which read as a rendering fault
    // rather than as a robot standing on something. The pile still shows
    // around him, the way it does under every pack.
    ctx.beginPath();
    ctx.moveTo(0, -size / 2);
    ctx.lineTo(size / 2, size / 2);
    ctx.lineTo(-size / 2, size / 2);
    ctx.closePath();
    fillAsSheet(ctx, palette);

    ctx.beginPath();
    ctx.moveTo(0, -size / 2);
    ctx.lineTo(size / 2, size / 2);
    ctx.lineTo(0, size / 5);
    ctx.lineTo(-size / 2, size / 2);
    ctx.closePath();
    ctx.strokeStyle = palette.karel;
    ctx.lineWidth = stroke;
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.restore();
  },

  drawCursor(c, cell) {
    const { ctx, layout, palette } = c;
    const corner = c.corner(cell.x, cell.y);
    const inset = Math.max(2, Math.round(layout.cell * 0.1));
    ctx.save();
    ctx.fillStyle = palette.cursor;
    ctx.fillRect(corner.x, corner.y, layout.cell, layout.cell);
    // A mat inside the fill: the drafted way to say "this one", where the
    // terminal pack would simply invert the cell.
    ctx.strokeStyle = palette.background;
    ctx.lineWidth = 1;
    ctx.strokeRect(
      corner.x + inset + 0.5,
      corner.y + inset + 0.5,
      layout.cell - inset * 2 - 1,
      layout.cell - inset * 2 - 1
    );
    ctx.restore();
  },

  drawEdgeCursor(c, wall) {
    const { ctx, palette } = c;
    const segment = c.segment(wall);
    const width = clamp(classicWallWidth(c) + 2, 4, c.maxWallWidth);
    ctx.save();
    ctx.strokeStyle = palette.cursor;
    ctx.fillStyle = palette.cursor;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(segment.x1, segment.y1);
    ctx.lineTo(segment.x2, segment.y2);
    ctx.stroke();
    ctx.restore();
  },

  drawSwatch({ ctx, palette, width, height }) {
    ctx.fillStyle = palette.background;
    ctx.fillRect(0, 0, width, height);
    ctx.beginPath();
    ctx.rect(2, 2, width - 4, height - 4);
    fillAsSheet(ctx, palette);

    ctx.strokeStyle = palette.wall;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.strokeRect(1.5, 1.5, width - 3, height - 3);

    const size = height * 0.62;
    ctx.save();
    ctx.translate(width * 0.28, height * 0.5);
    ctx.rotate(Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(0, -size / 2);
    ctx.lineTo(size / 2, size / 2);
    ctx.lineTo(0, size / 5);
    ctx.lineTo(-size / 2, size / 2);
    ctx.closePath();
    ctx.strokeStyle = palette.karel;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    const reach = Math.min(width, height) * 0.22;
    const cx = width * 0.72;
    const cy = height * 0.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy - reach);
    ctx.lineTo(cx + reach, cy);
    ctx.lineTo(cx, cy + reach);
    ctx.lineTo(cx - reach, cy);
    ctx.closePath();
    ctx.fillStyle = palette.beeper;
    ctx.fill();
  },
};

// ── The set, and which one is on ──────────────────────────────────────────

export const SKINS: readonly Skin[] = [terminalSkin, blocksSkin, classicSkin];

export const DEFAULT_SKIN = "terminal";
const STORAGE_KEY = "karel.skin";

export function skinById(id: string): Skin | null {
  return SKINS.find((skin) => skin.id === id) ?? null;
}

let active: Skin = terminalSkin;
const listeners = new Set<() => void>();

/** The pack the world is being drawn with. */
export function activeSkin(): Skin {
  return active;
}

export function currentSkin(): string {
  return active.id;
}

/** Switch packs. An unknown id is ignored, the way an unknown theme is. */
export function setSkin(id: string): void {
  const skin = skinById(id);
  if (!skin || skin === active) {
    return;
  }
  active = skin;
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Private browsing, or storage disabled. The pack still applies for this
    // visit; only remembering it fails, which is not worth interrupting for.
  }
  for (const listener of listeners) {
    listener();
  }
}

/** Called after the pack changes. Returns the function that unsubscribes. */
export function onSkinChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Adopt the stored pack.
 *
 * Unlike the theme there is no inline script racing this one: a pack only
 * decides what the canvas draws, and nothing is drawn until the module that
 * draws it has loaded. There is no frame in which the wrong pack is visible.
 */
export function restoreSkin(): void {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      setSkin(stored);
    }
  } catch {
    // Nothing to restore.
  }
}

/** Test seam: put the module back the way it loads. */
export function resetSkinForTests(): void {
  active = terminalSkin;
  listeners.clear();
}

// ── The picker ────────────────────────────────────────────────────────────

/**
 * The chooser, built here rather than in main.ts.
 *
 * Two reasons, and the second is the real one. A pack is a rendering concern
 * from end to end — the swatch is drawn by the pack itself, with the pack's
 * own hand, so the preview can never drift from what the world will actually
 * look like. And main.ts is the file every other part of this app also has to
 * reach into; the less of it a new feature claims, the better.
 *
 * All main.ts owes this module is two calls at start-up, beside the theme's:
 *
 *     restoreSkin();
 *     mountSkinPicker();
 *
 * `mountSkinPicker` finds its own container (`#skins` in index.html),
 * translates its own subtree, repaints itself when the palette changes and
 * keeps its own pressed state in step. It does nothing at all if the
 * container is absent, so a page that has not made room for it still runs.
 */

const SWATCH_WIDTH = 26;
const SWATCH_HEIGHT = 16;

/** Draw one pack's miniature, at the current device pixel ratio. */
function paintSwatch(canvas: HTMLCanvasElement, skin: Skin, palette: ThemeColors): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  const dpr = window.devicePixelRatio || 1;
  const pixelWidth = Math.round(SWATCH_WIDTH * dpr);
  const pixelHeight = Math.round(SWATCH_HEIGHT * dpr);
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, SWATCH_WIDTH, SWATCH_HEIGHT);
  skin.drawSwatch({ ctx, palette, width: SWATCH_WIDTH, height: SWATCH_HEIGHT });
}

/**
 * Build the pack buttons into `container` and wire them up.
 *
 * Returns the repaint, which is what a theme change needs: a swatch is drawn
 * in the active palette, so the previews change colour with everything else.
 */
export function buildSkinPicker(container: HTMLElement, palette: () => ThemeColors): () => void {
  const entries: { skin: Skin; button: HTMLButtonElement; canvas: HTMLCanvasElement }[] = [];

  for (const skin of SKINS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "skin-swatch";
    button.dataset["skin"] = skin.id;
    // The pack's own name is not translated -- "blocks" is what it is called
    // in either language -- so only the sentence around it goes through the
    // catalogue.
    //
    // Not marked with `data-i18n-aria`, deliberately. That sweep calls `t`
    // with no variables, so a key carrying a `{name}` placeholder comes out of
    // it with the placeholder still in it, read aloud as "brace name brace
    // skin". These labels are re-worded by `refresh` instead, which has the
    // name to hand.
    button.title = skin.label;

    const canvas = document.createElement("canvas");
    canvas.style.width = `${SWATCH_WIDTH}px`;
    canvas.style.height = `${SWATCH_HEIGHT}px`;
    canvas.setAttribute("aria-hidden", "true");
    button.append(canvas);

    button.addEventListener("click", () => setSkin(skin.id));
    container.append(button);
    entries.push({ skin, button, canvas });
  }

  const refresh = (): void => {
    const colours = palette();
    for (const entry of entries) {
      entry.button.setAttribute("aria-pressed", String(entry.skin.id === currentSkin()));
      entry.button.setAttribute("aria-label", t("masthead.skinOption", { name: entry.skin.label }));
      paintSwatch(entry.canvas, entry.skin, colours);
    }
  };

  onSkinChange(refresh);
  refresh();
  return refresh;
}

/**
 * Put the picker on the page, if the page has somewhere to put it.
 *
 * Safe to call twice: a container that already holds swatches is left alone,
 * so a restructured chrome that rebuilds its masthead cannot end up with six
 * buttons.
 */
export function mountSkinPicker(container: HTMLElement | null = null): (() => void) | null {
  const host = container ?? document.querySelector<HTMLElement>("#skins");
  if (!host || host.querySelector(".skin-swatch")) {
    return null;
  }
  const refresh = buildSkinPicker(host, colors);
  // A swatch is drawn in the active palette and labelled in the active
  // language, so it has to answer to both.
  onThemeChange(refresh);
  onLocaleChange(refresh);
  return refresh;
}
