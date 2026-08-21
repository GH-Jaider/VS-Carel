/**
 * The world, drawn on a 2-D canvas.
 *
 * Ported from the VS Code webview renderer (packages/vscode/media/webview.js):
 * the layout arithmetic, the wall-edge arithmetic, the Y flip and Karel's
 * rotated triangle are the same code, which had already been proved against
 * real maps. What did not come across is everything that made it a webview --
 * the postMessage protocol, the persisted state and the `--vscode-*` colour
 * reads, which are now `theme.ts` custom properties.
 *
 * The geometry is exported as free functions over a plain `Layout` record so
 * the map editor can ask "which cell is this pixel?" -- and so the whole of it
 * can be tested without a canvas.
 *
 * What the world is drawn *as* is not here. This file owns the layout, the hit
 * test and the order the frame is painted in; `skins.ts` owns the shapes. The
 * seam is deliberate and one-way: a skin is handed the geometry it needs
 * rather than deriving it, so a pack can change every mark on the canvas
 * without being able to move where a click lands.
 */

import type { Dimensions, KarelMap, Wall } from "@karel/core";
import type { HitTarget, RenderOptions, ThemeColors, WorldRenderer } from "../contracts";
import { activeSkin, onSkinChange, type SkinContext } from "./skins";
import { colors, onThemeChange } from "./theme";

/**
 * The strip the layout reserves around the grid for the rim.
 *
 * It is a layout constant, not a style: it decides how big the bitmap is and
 * where the origin sits, so it has to be the same whichever skin is on. A
 * skin may draw a wall anywhere up to twice this wide -- the rim is stroked
 * centred on the boundary, so half of it falls into the reserve -- and is
 * told so through `SkinContext.maxWallWidth`.
 */
const WALL_WIDTH = 4;
/** Room along the bottom and the left for the 1-based axis numbers. */
const AXIS_MARGIN = 25;
/** Small enough panels stay readable; large ones stop looking absurd. */
const MIN_CELL = 16;
// A ceiling only so a 1x1 world does not become a single enormous square. It
// was low enough that a small teaching world sat tiny in a tall column with a
// screen of nothing above it, which is the opposite of what a beginner needs:
// the fewer corners there are, the larger each one should be.
const MAX_CELL = 120;
const FIT_PADDING = 8;

/**
 * How close to an interior boundary a point has to fall, as a fraction of the
 * cell, before it counts as a hit on the wall slot rather than on the cell.
 */
export const EDGE_THRESHOLD = 0.25;

/** Used when there is nothing to measure yet -- a detached or unstyled canvas. */
const FALLBACK_AVAILABLE: Dimensions = { width: 640, height: 480 };

export interface Point {
  x: number;
  y: number;
}

/**
 * Where the world sits on the canvas, in CSS pixels.
 *
 * `originX`/`originY` are the top-left corner of cell (1, height) -- the
 * inside of the border wall. Everything else is derived from it and `cell`.
 */
export interface Layout {
  cell: number;
  originX: number;
  originY: number;
  /** Logical canvas size; the backing store is this times devicePixelRatio. */
  canvasWidth: number;
  canvasHeight: number;
  /** Zero when the axes are hidden, which shifts the grid left and down. */
  axisMargin: number;
  world: Dimensions;
}

// ── Geometry (pure) ───────────────────────────────────────────────────────

/**
 * Cell size that fits the world into the space available, clamped at both
 * ends. `available` is the container's inner box in CSS pixels.
 */
export function fitCellSize(world: Dimensions, available: Dimensions, showAxes = true): number {
  const axis = showAxes ? AXIS_MARGIN : 0;
  const usableWidth = available.width - FIT_PADDING * 2 - axis - WALL_WIDTH * 2;
  const usableHeight = available.height - FIT_PADDING * 2 - axis - WALL_WIDTH * 2;
  const fit = Math.floor(Math.min(usableWidth / world.width, usableHeight / world.height));
  // A zero-sized or not-yet-laid-out container gives NaN or -Infinity here.
  if (!Number.isFinite(fit)) {
    return MIN_CELL;
  }
  return Math.max(MIN_CELL, Math.min(fit, MAX_CELL));
}

export function computeLayout(world: Dimensions, available: Dimensions, showAxes = true): Layout {
  const cell = fitCellSize(world, available, showAxes);
  const axisMargin = showAxes ? AXIS_MARGIN : 0;
  // No centring here. The canvas element is sized to canvasWidth/Height, so
  // there is no slack inside the bitmap to centre within — offsetting the
  // origin only pushes the far columns past the right edge, where they are
  // neither drawn nor clickable. Centring the element in its box is the
  // stylesheet's job.
  const drawnWidth = axisMargin + world.width * cell + WALL_WIDTH * 2;
  const drawnHeight = axisMargin + world.height * cell + WALL_WIDTH * 2;
  return {
    cell,
    originX: axisMargin + WALL_WIDTH,
    originY: WALL_WIDTH,
    canvasWidth: drawnWidth,
    canvasHeight: drawnHeight,
    axisMargin,
    world: { width: world.width, height: world.height },
  };
}

/**
 * The centre of cell (x, y) in canvas pixels.
 *
 * This is where the Y flip happens: the world counts rows up from the bottom
 * and the canvas counts them down from the top.
 */
export function cellCenter(layout: Layout, x: number, y: number): Point {
  return {
    x: layout.originX + (x - 0.5) * layout.cell,
    y: layout.originY + (layout.world.height - y + 0.5) * layout.cell,
  };
}

/** The top-left corner of cell (x, y) in canvas pixels. */
export function cellCorner(layout: Layout, x: number, y: number): Point {
  return {
    x: layout.originX + (x - 1) * layout.cell,
    y: layout.originY + (layout.world.height - y) * layout.cell,
  };
}

/**
 * A wall in canonical form: `from` is the cell with the lower coordinate, so
 * the same boundary always produces the same record whichever side of it the
 * caller was looking at.
 */
export function normalizeWall(a: Point, b: Point): Wall {
  const firstIsLower = a.x < b.x || (a.x === b.x && a.y < b.y);
  return firstIsLower
    ? { from: { x: a.x, y: a.y }, to: { x: b.x, y: b.y } }
    : { from: { x: b.x, y: b.y }, to: { x: a.x, y: a.y } };
}

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * The line a wall is drawn as: the boundary between its two cells, one cell
 * long. Cells that share an x are stacked, so the wall between them runs
 * horizontally, and vice versa.
 */
export function wallSegment(layout: Layout, wall: Wall): Segment {
  const { cell, originX, originY, world } = layout;
  const { from, to } = wall;
  if (from.x === to.x) {
    const upper = Math.max(from.y, to.y);
    const x = originX + (from.x - 1) * cell;
    const y = originY + (world.height - upper + 1) * cell;
    return { x1: x, y1: y, x2: x + cell, y2: y };
  }
  const right = Math.max(from.x, to.x);
  const x = originX + (right - 1) * cell;
  const y = originY + (world.height - from.y) * cell;
  return { x1: x, y1: y, x2: x, y2: y + cell };
}

/** One boundary a point is close enough to, and how close in cell fractions. */
interface EdgeCandidate {
  distance: number;
  wall: Wall;
}

/**
 * The inverse of the layout arithmetic: canvas pixels back to what is under
 * them.
 *
 * Boundaries win over cells within `EDGE_THRESHOLD`, so the map editor can
 * place a beeper and toggle a wall with the same gesture. Only *interior*
 * boundaries are candidates -- the rim of the world is always walled and
 * cannot be toggled, so a click near it belongs to the cell.
 */
export function hitTestAt(layout: Layout, px: number, py: number): HitTarget {
  const { cell, world } = layout;
  const column = (px - layout.originX) / cell;
  const row = (py - layout.originY) / cell; // counted down from the top
  if (column < 0 || row < 0 || column > world.width || row > world.height) {
    return { kind: "outside" };
  }

  // Clamp so a point exactly on the far border still names the last cell
  // rather than one past it.
  const columnIndex = Math.min(world.width - 1, Math.floor(column));
  const rowIndex = Math.min(world.height - 1, Math.floor(row));
  const x = columnIndex + 1;
  const y = world.height - rowIndex;

  const withinX = column - columnIndex;
  const withinY = row - rowIndex;

  let vertical: EdgeCandidate | null = null;
  if (withinX <= EDGE_THRESHOLD && x > 1) {
    vertical = { distance: withinX, wall: normalizeWall({ x: x - 1, y }, { x, y }) };
  } else if (withinX >= 1 - EDGE_THRESHOLD && x < world.width) {
    vertical = { distance: 1 - withinX, wall: normalizeWall({ x, y }, { x: x + 1, y }) };
  }

  // Up the screen is up the world: the top of the cell borders y + 1.
  let horizontal: EdgeCandidate | null = null;
  if (withinY <= EDGE_THRESHOLD && y < world.height) {
    horizontal = { distance: withinY, wall: normalizeWall({ x, y }, { x, y: y + 1 }) };
  } else if (withinY >= 1 - EDGE_THRESHOLD && y > 1) {
    horizontal = { distance: 1 - withinY, wall: normalizeWall({ x, y: y - 1 }, { x, y }) };
  }

  // Near a corner both axes qualify; the nearer boundary is the one meant.
  const nearest =
    vertical && horizontal
      ? horizontal.distance < vertical.distance
        ? horizontal
        : vertical
      : (vertical ?? horizontal);

  return nearest ? { kind: "edge", wall: nearest.wall, x, y } : { kind: "cell", x, y };
}

// ── Renderer ──────────────────────────────────────────────────────────────

class CanvasWorldRenderer implements WorldRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private layout: Layout | null = null;
  private world: KarelMap | null = null;
  private options: RenderOptions = {};

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("This browser cannot provide a 2-D canvas context.");
    }
    this.ctx = ctx;
  }

  draw(world: KarelMap, options: RenderOptions = {}): void {
    this.world = world;
    this.options = options;
    this.paint();
  }

  /** Re-measure the container and draw the last world again at the new size. */
  resize(): void {
    this.paint();
  }

  /** Draw the last world again, unchanged -- after a theme or skin swap, say. */
  refresh(): void {
    this.paint();
  }

  hitTest(clientX: number, clientY: number): HitTarget {
    const layout = this.layout;
    if (!layout) {
      return { kind: "outside" };
    }
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return { kind: "outside" };
    }
    // The canvas is sized in CSS pixels to match the layout, but a stylesheet
    // is free to scale it anyway; go through the ratio instead of trusting 1:1.
    const px = (clientX - rect.left) * (layout.canvasWidth / rect.width);
    const py = (clientY - rect.top) * (layout.canvasHeight / rect.height);
    return hitTestAt(layout, px, py);
  }

  /** The container's inner box, which the world is fitted into. */
  private measure(): Dimensions {
    const container = this.canvas.parentElement;
    if (container && container.clientWidth > 0 && container.clientHeight > 0) {
      return { width: container.clientWidth, height: container.clientHeight };
    }
    return FALLBACK_AVAILABLE;
  }

  /**
   * One frame.
   *
   * The order is the whole of this method's opinion, and it is not the skin's
   * to change: the cursor goes under everything because it is a highlight of
   * the ground, not of what is standing on it; walls go over beepers because a
   * wall is between corners rather than on one; Karel goes over all of it
   * because he is what the eye is following.
   */
  private paint(): void {
    const world = this.world;
    if (!world) {
      return;
    }

    const showAxes = this.options.showAxes !== false;
    const layout = computeLayout(world.dimensions, this.measure(), showAxes);
    this.layout = layout;

    const ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.round(layout.canvasWidth * dpr);
    const pixelHeight = Math.round(layout.canvasHeight * dpr);
    // Assigning to width/height clears the canvas, so only do it when it
    // actually changed; every paint would otherwise start with a full reset.
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }
    this.canvas.style.width = `${layout.canvasWidth}px`;
    this.canvas.style.height = `${layout.canvasHeight}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const skin = activeSkin();
    const c = skinContext(ctx, layout, colors());

    skin.drawBackground(c);

    const cursor = this.options.cursor;
    const { width, height } = layout.world;
    if (cursor && cursor.x >= 1 && cursor.x <= width && cursor.y >= 1 && cursor.y <= height) {
      skin.drawCursor(c, cursor);
    }
    if (this.options.edge) {
      skin.drawEdgeCursor(c, this.options.edge);
    }
    if (showAxes) {
      skin.drawAxes(c);
    }
    skin.drawGrid(c);
    skin.drawBeepers(c, world.beepers);
    skin.drawWalls(c, world.walls);
    skin.drawKarel(c, world.karel);

    // A skin is one object shared by every renderer on the page, so it is not
    // allowed to leave state behind on the context. Resetting the two settings
    // that survive a `save`/`restore` mismatch is cheaper than trusting three
    // packs to be perfectly balanced for ever.
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
}

/**
 * The handle a skin draws through.
 *
 * Everything positional is a closure over this layout, which is why a pack
 * cannot invent its own arithmetic: the only way to find out where cell (3,4)
 * is, is to ask the function the hit test is the inverse of.
 */
function skinContext(
  ctx: CanvasRenderingContext2D,
  layout: Layout,
  palette: ThemeColors
): SkinContext {
  return {
    ctx,
    layout,
    palette,
    // A wall may be twice the reserve wide, because the rim can grow inward;
    // past that even a rim pinned to the edge of the reserve would spill.
    maxWallWidth: WALL_WIDTH * 2,
    rimRoom: WALL_WIDTH,
    center: (x, y) => cellCenter(layout, x, y),
    corner: (x, y) => cellCorner(layout, x, y),
    segment: (wall) => wallSegment(layout, wall),
  };
}

export function createRenderer(canvas: HTMLCanvasElement): WorldRenderer {
  const renderer = new CanvasWorldRenderer(canvas);
  // The palette lives in CSS and the shapes live in skins.ts, so a theme swap
  // or a pack swap changes the canvas without the rest of the app being
  // involved. Repaint from here rather than asking every caller to remember to.
  onThemeChange(() => renderer.refresh());
  onSkinChange(() => renderer.refresh());
  return renderer;
}
