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
 */

import type { Dimensions, KarelMap, Wall } from "@karel/core";
import type { HitTarget, RenderOptions, ThemeColors, WorldRenderer } from "../contracts";
import { colors, onThemeChange } from "./theme";

/** Walls are objects in the world, not hairlines: they are drawn thick. */
const WALL_WIDTH = 4;
/** Room along the bottom and the left for the 1-based axis numbers. */
const AXIS_MARGIN = 25;
/** Small enough panels stay readable; large ones stop looking absurd. */
const MIN_CELL = 16;
const MAX_CELL = 72;
const FIT_PADDING = 8;

/**
 * How close to an interior boundary a point has to fall, as a fraction of the
 * cell, before it counts as a hit on the wall slot rather than on the cell.
 */
export const EDGE_THRESHOLD = 0.25;

/** Used when there is nothing to measure yet -- a detached or unstyled canvas. */
const FALLBACK_AVAILABLE: Dimensions = { width: 640, height: 480 };

const MONO = '"JetBrains Mono", ui-monospace, monospace';

/** Karel's triangle points north at rest; each facing is a rotation of it. */
const ROTATIONS: Record<string, number> = {
  north: 0,
  west: -Math.PI / 2,
  south: Math.PI,
  east: Math.PI / 2,
};

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

  /** Draw the last world again, unchanged -- after a theme swap, say. */
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

    const palette = colors();
    ctx.fillStyle = palette.background;
    ctx.fillRect(0, 0, layout.canvasWidth, layout.canvasHeight);

    const cursor = this.options.cursor;
    if (cursor) {
      this.paintCursor(layout, palette, cursor);
    }
    if (this.options.edge) {
      this.paintEdgeCursor(layout, palette, this.options.edge);
    }
    if (showAxes) {
      this.paintAxes(layout, palette);
    }
    this.paintGrid(layout, palette);
    this.paintBeepers(layout, palette, world);
    this.paintWalls(layout, palette, world);
    this.paintKarel(layout, palette, world);
  }

  /** Video inverse: the selected cell is a solid block, as in a terminal. */
  private paintCursor(layout: Layout, palette: ThemeColors, cursor: Point): void {
    const { width, height } = layout.world;
    if (cursor.x < 1 || cursor.x > width || cursor.y < 1 || cursor.y > height) {
      return;
    }
    const corner = cellCorner(layout, cursor.x, cursor.y);
    this.ctx.fillStyle = palette.cursor;
    this.ctx.fillRect(corner.x, corner.y, layout.cell, layout.cell);
  }

  /**
   * The wall a click would place, drawn where it would land and a little
   * thicker than a real one, so it reads as an intention rather than as
   * something already there.
   */
  private paintEdgeCursor(layout: Layout, palette: ThemeColors, wall: Wall): void {
    const segment = wallSegment(layout, wall);
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = palette.cursor;
    ctx.lineWidth = WALL_WIDTH + 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(segment.x1, segment.y1);
    ctx.lineTo(segment.x2, segment.y2);
    ctx.stroke();
    ctx.restore();
  }

  private paintAxes(layout: Layout, palette: ThemeColors): void {
    const ctx = this.ctx;
    const { width, height } = layout.world;
    ctx.fillStyle = palette.label;
    ctx.font = `10px ${MONO}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let x = 1; x <= width; x++) {
      const center = cellCenter(layout, x, 1);
      ctx.fillText(String(x), center.x, layout.canvasHeight - AXIS_MARGIN / 2);
    }
    for (let y = 1; y <= height; y++) {
      const center = cellCenter(layout, 1, y);
      ctx.fillText(String(y), AXIS_MARGIN / 2, center.y);
    }
  }

  /**
   * The interior lattice, dotted -- the rim is drawn later as a solid wall,
   * because the border of the world really is walled.
   */
  private paintGrid(layout: Layout, palette: ThemeColors): void {
    const ctx = this.ctx;
    const { cell, originX, originY, world } = layout;
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
    ctx.setLineDash([]);
  }

  /**
   * A pile and its count. The count is the point of the exercise, so it is
   * always drawn, even for a single beeper.
   */
  private paintBeepers(layout: Layout, palette: ThemeColors, world: KarelMap): void {
    const ctx = this.ctx;
    const radius = layout.cell * 0.28;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const beeper of world.beepers) {
      if (beeper.count < 1) {
        continue;
      }
      const center = cellCenter(layout, beeper.x, beeper.y);

      ctx.fillStyle = palette.beeper;
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
      ctx.fill();

      const label = String(beeper.count);
      ctx.fillStyle = palette.beeperLabel;
      ctx.font = `${this.fitLabel(label, radius * 1.7, layout.cell * 0.34)}px ${MONO}`;
      ctx.fillText(label, center.x, center.y);
    }
  }

  /** The largest size in the type scale at which `text` still fits `maxWidth`. */
  private fitLabel(text: string, maxWidth: number, preferred: number): number {
    const scale = [9.5, 10, 10.5, 11, 11.5, 12, 12.5];
    let chosen = scale[0]!;
    for (const size of scale) {
      if (size > preferred) {
        break;
      }
      this.ctx.font = `${size}px ${MONO}`;
      if (this.ctx.measureText(text).width > maxWidth) {
        break;
      }
      chosen = size;
    }
    return chosen;
  }

  private paintWalls(layout: Layout, palette: ThemeColors, world: KarelMap): void {
    const ctx = this.ctx;
    ctx.strokeStyle = palette.wall;
    ctx.lineWidth = WALL_WIDTH;
    ctx.lineCap = "square";
    ctx.beginPath();
    for (const wall of world.walls) {
      const segment = wallSegment(layout, wall);
      ctx.moveTo(segment.x1, segment.y1);
      ctx.lineTo(segment.x2, segment.y2);
    }
    ctx.stroke();

    // The rim, which is walled by definition and never stored in the map.
    ctx.strokeRect(
      layout.originX - WALL_WIDTH / 2,
      layout.originY - WALL_WIDTH / 2,
      layout.world.width * layout.cell + WALL_WIDTH,
      layout.world.height * layout.cell + WALL_WIDTH
    );
  }

  private paintKarel(layout: Layout, palette: ThemeColors, world: KarelMap): void {
    const ctx = this.ctx;
    const center = cellCenter(layout, world.karel.x, world.karel.y);
    const size = layout.cell * 0.7;

    ctx.save();
    ctx.translate(center.x, center.y);
    ctx.rotate(ROTATIONS[world.karel.facing] ?? 0);

    ctx.fillStyle = palette.karel;
    ctx.beginPath();
    ctx.moveTo(0, -size / 2);
    ctx.lineTo(-size / 3, size / 3);
    ctx.lineTo(size / 3, size / 3);
    ctx.closePath();
    ctx.fill();

    // Outlined in the background colour so Karel stays legible standing on a
    // pile of beepers.
    ctx.strokeStyle = palette.background;
    ctx.lineWidth = 2;
    ctx.lineJoin = "miter";
    ctx.stroke();

    ctx.restore();
  }
}

export function createRenderer(canvas: HTMLCanvasElement): WorldRenderer {
  const renderer = new CanvasWorldRenderer(canvas);
  // The palette lives in CSS, so a theme swap changes every colour on the
  // canvas without the rest of the app being involved. Repaint from here
  // rather than asking every caller to remember to.
  onThemeChange(() => renderer.refresh());
  return renderer;
}
