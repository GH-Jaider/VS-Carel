/**
 * The worlds and programs the app knows about, and where a visitor's own work
 * is kept between visits.
 *
 * There is no filesystem here, which turns out to be a feature: a world is
 * either one of the built-in exercises, a file dropped onto the page, or
 * whatever is in localStorage from last time. The .klm format is the same JSON
 * the editor and the CLI read, so a world built here grades there.
 */

import { validateKarelMap, type KarelMap } from "@karel/core";

export interface Exercise {
  id: string;
  label: string;
  /** Shown in the "how it works" dialog when this exercise is selected. */
  brief: string;
  world: KarelMap;
  /** The program the editor opens with. */
  program: string;
}

const PROGRAM_SKELETON = `BEGINNING-OF-PROGRAM
    BEGINNING-OF-EXECUTION

    END-OF-EXECUTION
END-OF-PROGRAM
`;

function world(source: unknown): KarelMap {
  const result = validateKarelMap(source);
  if (!result.ok || !result.map) {
    // A built-in that does not validate is a bug in this file, not bad input,
    // and it should surface the moment the page loads rather than later.
    throw new Error(`built-in world is invalid: ${result.errors.join(", ")}`);
  }
  return result.map;
}

export const EXERCISES: Exercise[] = [
  {
    id: "first-steps",
    label: "first steps",
    brief:
      "An empty 8 by 8 world. Move Karel around and get a feel for the four " +
      "instructions that do anything: move, turnleft, pickbeeper, putbeeper.",
    world: world({
      dimensions: { width: 8, height: 8 },
      karel: { x: 1, y: 1, facing: "east", beepers: 0 },
      beepers: [],
      walls: [],
    }),
    program: PROGRAM_SKELETON,
  },
  {
    id: "collect",
    label: "collect",
    brief:
      "Three beepers sit in a row ahead of Karel. Pick up all of them and " +
      "come back to the corner you started from.",
    world: world({
      dimensions: { width: 8, height: 5 },
      karel: { x: 1, y: 1, facing: "east", beepers: 0 },
      beepers: [
        { x: 3, y: 1, count: 1 },
        { x: 5, y: 1, count: 1 },
        { x: 7, y: 1, count: 1 },
      ],
      walls: [],
    }),
    program: PROGRAM_SKELETON,
  },
  {
    id: "maze",
    label: "maze",
    brief:
      "A wall stands between Karel and the beeper. Walls block movement in " +
      "both directions, and front-is-clear is how Karel finds out.",
    world: world({
      dimensions: { width: 8, height: 6 },
      karel: { x: 1, y: 1, facing: "north", beepers: 0 },
      beepers: [{ x: 6, y: 5, count: 1 }],
      walls: [
        { from: { x: 3, y: 1 }, to: { x: 4, y: 1 } },
        { from: { x: 3, y: 2 }, to: { x: 4, y: 2 } },
        { from: { x: 3, y: 3 }, to: { x: 4, y: 3 } },
        { from: { x: 3, y: 4 }, to: { x: 4, y: 4 } },
      ],
    }),
    program: PROGRAM_SKELETON,
  },
  {
    id: "sandbox",
    label: "sandbox",
    brief:
      "The world from the repository's examples, with a few piles and a few " +
      "walls. Nothing to solve — a place to try things.",
    world: world({
      dimensions: { width: 10, height: 8 },
      karel: { x: 1, y: 1, facing: "north", beepers: 5 },
      beepers: [
        { x: 3, y: 3, count: 2 },
        { x: 5, y: 5, count: 1 },
        { x: 8, y: 2, count: 3 },
      ],
      walls: [
        { from: { x: 4, y: 3 }, to: { x: 4, y: 4 } },
        { from: { x: 4, y: 4 }, to: { x: 4, y: 5 } },
        { from: { x: 4, y: 5 }, to: { x: 5, y: 5 } },
        { from: { x: 6, y: 1 }, to: { x: 6, y: 2 } },
        { from: { x: 6, y: 2 }, to: { x: 7, y: 2 } },
      ],
    }),
    program: `BEGINNING-OF-PROGRAM
    DEFINE-NEW-INSTRUCTION turnright AS
    BEGIN
        turnleft;
        turnleft;
        turnleft
    END

    BEGINNING-OF-EXECUTION
        move;
        move;
        turnright;
        move;
        IF next-to-a-beeper THEN
        BEGIN
            pickbeeper
        END
        ELSE
        BEGIN
            putbeeper
        END
        turnright;
        ITERATE 2 TIMES
        BEGIN
            move
        END
        turnoff
    END-OF-EXECUTION
END-OF-PROGRAM
`,
  },
];

// ── Persistence ───────────────────────────────────────────────────────────

const STORAGE_KEY = "karel.workspace";

export interface StoredWorkspace {
  exerciseId: string;
  program: string;
  /** Present only when the user has edited the world away from the built-in. */
  world?: KarelMap;
  speedMs?: number;
}

/**
 * Storage can throw outright, not merely come back empty: a private window or
 * a browser set to block site data rejects the accessor itself. Nothing here
 * is worth failing the page load for.
 */
export function loadWorkspace(): StoredWorkspace | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as StoredWorkspace;
    if (typeof parsed?.exerciseId !== "string" || typeof parsed?.program !== "string") {
      return null;
    }
    if (parsed.world) {
      const validated = validateKarelMap(parsed.world);
      if (!validated.ok || !validated.map) {
        // Keep the program, drop a world we can no longer read.
        delete parsed.world;
      } else {
        parsed.world = validated.map;
      }
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveWorkspace(workspace: StoredWorkspace): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
  } catch {
    // Out of quota, or storage denied. The session still works; it just will
    // not be here tomorrow.
  }
}

export function exerciseById(id: string): Exercise {
  return EXERCISES.find((e) => e.id === id) ?? EXERCISES[0];
}

// ── Import and export ─────────────────────────────────────────────────────

export type ImportResult = { ok: true; world: KarelMap } | { ok: false; error: string };

/** Read a .klm a visitor dropped on the page or picked with the file input. */
export function parseWorldFile(text: string): ImportResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return { ok: false, error: `That file is not valid JSON: ${(error as Error).message}` };
  }
  const validated = validateKarelMap(data);
  if (!validated.ok || !validated.map) {
    return { ok: false, error: validated.errors.join("\n") };
  }
  return { ok: true, world: validated.map };
}

/** Offer `world` as a .klm download, in the exact shape the CLI expects. */
export function downloadWorld(world: KarelMap, filename: string): void {
  const blob = new Blob([`${JSON.stringify(world, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".klm") ? filename : `${filename}.klm`;
  link.click();
  URL.revokeObjectURL(url);
}

export function downloadProgram(source: string, filename: string): void {
  const blob = new Blob([source], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".kli") ? filename : `${filename}.kli`;
  link.click();
  URL.revokeObjectURL(url);
}
