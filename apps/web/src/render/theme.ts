/**
 * Theme access for everything drawn on the canvas.
 *
 * The palettes live in the stylesheet, not here — and since teletipo, neither
 * does the switching: which palette is active, persistence under
 * "karel.theme" and change notification are the library's ThemeController,
 * created once below. What remains Karel's own is the mapping from canvas
 * colour to custom property (PROPERTIES), the cold-load FALLBACKS, and the
 * public surface main.ts, the skins and the tests already know.
 *
 * Resolving a custom property is not free, so the whole set is read once per
 * theme change and cached — teletipo's createTokenReader wires that cache to
 * the controller.
 */

import { createTheme, createTokenReader } from "teletipo";
import type { ThemeColors, ThemeId } from "../contracts";

export type { ThemeColors, ThemeId };

export const THEMES: ThemeId[] = [
  { id: "charm", label: "charm" },
  { id: "matte", label: "matte" },
  { id: "ember", label: "ember" },
  { id: "paper", label: "paper" },
];

/** Which theme is active, remembered under Karel's own key. */
const controller = createTheme({ storageKey: "karel.theme" });

/** The custom property each canvas colour is read from. */
const PROPERTIES: Record<keyof ThemeColors, string> = {
  background: "--canvas-bg",
  grid: "--grid",
  label: "--canvas-label",
  karel: "--karel",
  beeper: "--beeper",
  beeperLabel: "--beeper-label",
  wall: "--wall",
  cursor: "--cursor",
};

/**
 * The default theme's palette, hard-coded.
 *
 * Not a second source of truth: it is what the renderer draws with when there
 * is no stylesheet to read from -- the first frame of a cold load, or a test
 * running without a document. A blank canvas would be a worse answer than a
 * frame in slightly stale colours.
 */
const FALLBACKS: Record<keyof ThemeColors, string> = {
  background: "#0c0c12",
  grid: "#2b2b39",
  label: "#61617a",
  karel: "#4fe3d2",
  beeper: "#ffc861",
  beeperLabel: "#0c0c12",
  wall: "#e6e6f0",
  cursor: "#a98bff",
};

const reader = createTokenReader(controller, PROPERTIES, FALLBACKS);

/** The resolved palette for whichever theme is active. */
export function colors(): ThemeColors {
  return reader.read();
}

/** The id of the active theme, in the form `setTheme` accepts back. */
export const currentTheme = controller.currentTheme;

export function setTheme(id: string): void {
  // The library ignores ids outside its own list; this array is the same four
  // palettes, so an unknown id is dropped exactly as it always was here.
  if (!THEMES.some((entry) => entry.id === id)) {
    return;
  }
  controller.setTheme(id);
}

/**
 * Called after the palette changes, once the new one is already resolvable.
 * Returns the function that unsubscribes.
 */
export const onThemeChange = controller.onChange;

/**
 * Adopt the stored theme.
 *
 * A small inline script in the document head does this too, before first
 * paint, so the page never flashes the default palette. This is the fallback
 * for when that script did not run.
 */
export const restoreTheme = controller.restoreTheme;
