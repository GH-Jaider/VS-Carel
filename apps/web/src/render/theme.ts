/**
 * Theme access for everything drawn on the canvas.
 *
 * The palettes live in the stylesheet, not here. That keeps a colour written
 * down exactly once -- the chrome takes it through `var(--x)` and the canvas
 * reads the same property back with `getComputedStyle`. The alternative, a
 * table of hexes in TypeScript mirrored by a table of hexes in CSS, drifts
 * apart the first time anyone adjusts one of them.
 *
 * Resolving a custom property is not free, so the whole set is read once per
 * theme change and cached.
 */

import type { ThemeColors, ThemeId } from "../contracts";

export type { ThemeColors, ThemeId };

export const THEMES: ThemeId[] = [
  { id: "charm", label: "charm" },
  { id: "onyx", label: "onyx" },
  { id: "ember", label: "ember" },
  { id: "paper", label: "paper" },
];

const DEFAULT_THEME = "charm";
const STORAGE_KEY = "karel.theme";

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

let cache: ThemeColors | null = null;
const listeners = new Set<() => void>();

function read(): ThemeColors {
  if (typeof document === "undefined") {
    return { ...FALLBACKS };
  }
  const style = getComputedStyle(document.documentElement);
  const value = (key: keyof ThemeColors): string =>
    style.getPropertyValue(PROPERTIES[key]).trim() || FALLBACKS[key];
  return {
    background: value("background"),
    grid: value("grid"),
    label: value("label"),
    karel: value("karel"),
    beeper: value("beeper"),
    beeperLabel: value("beeperLabel"),
    wall: value("wall"),
    cursor: value("cursor"),
  };
}

/** The resolved palette for whichever theme is active. */
export function colors(): ThemeColors {
  if (!cache) {
    cache = read();
  }
  return cache;
}

/** The id of the active theme, in the form `setTheme` accepts back. */
export function currentTheme(): string {
  if (typeof document === "undefined") {
    return DEFAULT_THEME;
  }
  return document.documentElement.dataset["theme"] ?? DEFAULT_THEME;
}

export function setTheme(id: string): void {
  if (!THEMES.some((entry) => entry.id === id)) {
    return;
  }
  // The default palette is the bare `:root` rule, so it is expressed by the
  // absence of the attribute rather than by a value.
  if (id === DEFAULT_THEME) {
    delete document.documentElement.dataset["theme"];
  } else {
    document.documentElement.dataset["theme"] = id;
  }
  cache = null;
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Private browsing, or storage disabled. The theme still applies for this
    // visit; only remembering it fails, which is not worth interrupting for.
  }
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Called after the palette changes, once the new one is already resolvable.
 * Returns the function that unsubscribes.
 */
export function onThemeChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Adopt the stored theme.
 *
 * A small inline script in the document head does this too, before first
 * paint, so the page never flashes the default palette. This is the fallback
 * for when that script did not run.
 */
export function restoreTheme(): void {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && stored !== currentTheme()) {
      setTheme(stored);
    }
  } catch {
    // Nothing to restore.
  }
}
