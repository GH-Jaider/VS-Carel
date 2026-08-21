/**
 * The seams between the app's parts, written down in one place.
 *
 * The renderer, the editor and the chrome are built independently and only
 * meet in main.ts, so what they promise each other lives here rather than
 * being inferred from whichever file happened to be written first.
 */

import type { Diagnostic, KarelMap, Wall } from "@karel/core";

// ── Theme ─────────────────────────────────────────────────────────────────

/**
 * Canvas colours, read back from the stylesheet.
 *
 * Palettes are defined in CSS and nowhere else: the chrome takes them through
 * var(--x) and the canvas reads the same properties with getComputedStyle. A
 * table of hexes here mirrored by a table of hexes there drifts apart the
 * first time someone adjusts one of them.
 */
export interface ThemeColors {
  background: string;
  /** The faint rule between cells. */
  grid: string;
  /** Axis numbers and any other text drawn on the canvas. */
  label: string;
  karel: string;
  beeper: string;
  /** Beeper counts, drawn on top of a pile. */
  beeperLabel: string;
  wall: string;
  /** The cell under the cursor, in edit mode. */
  cursor: string;
}

export interface ThemeId {
  id: string;
  label: string;
}

// ── World rendering ───────────────────────────────────────────────────────

export interface RenderOptions {
  /** Draw the 1-based axis numbers along the bottom and left. */
  showAxes?: boolean;
  /** Highlight one cell, for the map editor's cursor. */
  cursor?: { x: number; y: number } | null;
}

/**
 * What a click landed on. Corners and the edges between them are both
 * targets, so the map editor can place a beeper or toggle a wall from the
 * same gesture; `edge` wins when the point is close enough to a boundary.
 */
export type HitTarget =
  | { kind: "cell"; x: number; y: number }
  | { kind: "edge"; wall: Wall }
  | { kind: "outside" };

export interface WorldRenderer {
  /** Draw `world`, fitting it to the canvas and respecting devicePixelRatio. */
  draw(world: KarelMap, options?: RenderOptions): void;
  /** Re-measure after a resize. Cheap enough to call from a ResizeObserver. */
  resize(): void;
  /** Map a pointer event's client coordinates onto the world. */
  hitTest(clientX: number, clientY: number): HitTarget;
}

// ── Editor ────────────────────────────────────────────────────────────────

export interface KarelEditor {
  getSource(): string;
  setSource(source: string): void;
  /** Underline these; pass an empty array to clear. */
  setDiagnostics(diagnostics: Diagnostic[]): void;
  /**
   * Mark the line being executed, scrolling it into view. Pass null to clear.
   * Lines are 1-based, as the parser reports them.
   */
  setActiveLine(line: number | null): void;
  /** Editing is disabled while a program runs, so the two cannot disagree. */
  setEditable(editable: boolean): void;
  onChange(listener: (source: string) => void): void;
  focus(): void;
}

// ── Session ───────────────────────────────────────────────────────────────

export type SessionState = "idle" | "running" | "stepping" | "error" | "done";

export interface SessionView {
  state: SessionState;
  /** The world as it stands right now: the starting map until something runs. */
  world: KarelMap;
  /** The line being executed, if any. */
  line: number | null;
  /** Visible instructions executed so far. */
  steps: number;
  /** Set in the error state. */
  message?: string;
}
