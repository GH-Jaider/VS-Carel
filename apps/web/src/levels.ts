/**
 * The level collection: a folder of JSON files, loaded and checked at boot.
 *
 * A level is one file in `apps/web/levels/`, picked up by Vite's glob import.
 * That is a deliberate choice and it is the whole reason `contribute.ts` can
 * work: adding a level is adding a file, so the browser can build the exact
 * text a contributor needs to hand over. A TypeScript array would have made
 * every contribution a patch to a source file that only a maintainer can
 * write, and there would be no way to produce it from inside the page.
 *
 * The price is that the files are data from an untrusted-ish source — a pull
 * request, a copy-paste, a hand edit — so nothing here trusts their shape.
 * `validateLevel` re-derives every field, `validateKarelMap` from the core
 * checks the two worlds, and a file that fails throws while the module loads
 * rather than half-rendering a broken level later. Loud and early: the test
 * suite runs the same validation over the same folder, so a bad level cannot
 * reach a build in the first place.
 *
 * Whether a level is *solved* is not decided here beyond delegating: the
 * verdict comes from the core's `sameExercise` and `compareWorlds`, which are
 * the same two functions the CLI grades submissions with. That is the point —
 * a student must not pass a level in the browser and fail it at the command
 * line.
 */

import { World, compareWorlds, sameExercise, validateKarelMap, type KarelMap } from "@karel/core";
import { currentLocale, type Locale } from "./i18n.js";

// ── The file schema ───────────────────────────────────────────────────────

/**
 * The difficulty bands, in the order they are shown.
 *
 * Ids, not labels: the wording belongs to the chrome's catalogue under
 * `levels.difficulty.<id>`, so a band reads "principiante" in Spanish without
 * every level file having to say so.
 */
export const DIFFICULTIES = ["starter", "tricky", "hard"] as const;

export type Difficulty = (typeof DIFFICULTIES)[number];

/** Where a level with no opinion about its position lands: at the end. */
export const DEFAULT_ORDER = 100;

/**
 * A string in as many languages as the contributor could manage.
 *
 * English is required and every other locale is optional, which is the one
 * concession this schema makes to the contribution flow: a level written by
 * someone who speaks one language is still worth having, and a missing
 * translation falls back to English rather than blocking the level. The
 * project's own levels carry both — a test asserts it — so the bundled
 * collection stays fully bilingual even though the schema does not demand it.
 */
export type LocalisedText = { en: string } & Partial<Record<Locale, string>>;

export interface Level {
  /** Also the file name: `apps/web/levels/<id>.json`. Unique, kebab-case. */
  id: string;
  difficulty: Difficulty;
  /** Position within the difficulty band; ties break on id. */
  order: number;
  /** Whoever wrote it — a GitHub handle, or a name. */
  author: string;
  title: LocalisedText;
  /** One sentence stating the task. Shown next to the world. */
  brief: LocalisedText;
  /**
   * Accept any final orientation. Set it when the brief says where to end up
   * but not which way to look, which is most of the time.
   */
  ignoreFacing?: boolean;
  /** The world the level starts in. */
  world: KarelMap;
  /** The world a correct program leaves behind. */
  goal: KarelMap;
  /**
   * A program that solves the level, verified by the test suite.
   *
   * It ships in the bundle, so it was never a secret; treat that as the
   * feature it is and let the mode offer it as "show me one way to do it"
   * rather than pretending it is hidden. Its real job is to be executable:
   * the test that runs every solution against its goal is what stops an
   * impossible level from being published.
   */
  solution: string;
  /** What the editor opens with. Defaults to an empty program skeleton. */
  program?: string;
}

/** The empty program a level opens with when it does not supply its own. */
export const PROGRAM_SKELETON = `BEGINNING-OF-PROGRAM
    BEGINNING-OF-EXECUTION

    END-OF-EXECUTION
END-OF-PROGRAM
`;

export interface LevelValidation {
  ok: boolean;
  errors: string[];
  level?: Level;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Locales a level file may carry text for. Mirrors the chrome's catalogue. */
const TEXT_LOCALES: Locale[] = ["en", "es"];

function readText(value: unknown, field: string, errors: string[]): LocalisedText | null {
  if (!isRecord(value)) {
    errors.push(`${field}: expected an object of locale to text`);
    return null;
  }
  if (typeof value.en !== "string" || value.en.trim() === "") {
    errors.push(`${field}.en: required, and must not be empty`);
    return null;
  }
  const text: LocalisedText = { en: value.en };
  for (const locale of TEXT_LOCALES) {
    const candidate = value[locale];
    if (candidate === undefined) {
      continue;
    }
    if (typeof candidate !== "string" || candidate.trim() === "") {
      errors.push(`${field}.${locale}: must be a non-empty string when present`);
      continue;
    }
    text[locale] = candidate;
  }
  return text;
}

function readWorld(value: unknown, field: string, errors: string[]): KarelMap | null {
  const result = validateKarelMap(value);
  if (!result.ok || !result.map) {
    errors.push(...result.errors.map((message) => `${field}: ${message}`));
    return null;
  }
  return result.map;
}

/**
 * Check one parsed level file and return it in its canonical shape.
 *
 * Errors accumulate rather than short-circuiting, because the audience is
 * whoever wrote the file: being told about four mistakes at once beats four
 * round trips. Messages are English only — they are addressed to a
 * contributor reading a test failure or a console, never to a student.
 */
export function validateLevel(data: unknown): LevelValidation {
  const errors: string[] = [];
  if (!isRecord(data)) {
    return { ok: false, errors: ["the file is not a JSON object"] };
  }

  const id = data.id;
  if (typeof id !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) {
    errors.push("id: required, lower-case kebab-case (a-z, 0-9 and single hyphens)");
  }

  const difficulty = data.difficulty;
  if (!DIFFICULTIES.includes(difficulty as Difficulty)) {
    errors.push(`difficulty: must be one of ${DIFFICULTIES.join(", ")}`);
  }

  // Absent means "last within the band", which is what a contributor who has
  // no opinion about where their level sits should get.
  const order = data.order === undefined ? DEFAULT_ORDER : data.order;
  if (typeof order !== "number" || !Number.isFinite(order)) {
    errors.push("order: must be a number when present");
  }

  const author = data.author;
  if (typeof author !== "string" || author.trim() === "") {
    errors.push("author: required");
  }

  const title = readText(data.title, "title", errors);
  const brief = readText(data.brief, "brief", errors);

  if (data.ignoreFacing !== undefined && typeof data.ignoreFacing !== "boolean") {
    errors.push("ignoreFacing: must be a boolean when present");
  }

  const world = readWorld(data.world, "world", errors);
  const goal = readWorld(data.goal, "goal", errors);

  // Dimensions and walls are the parts of a world no instruction can reach, so
  // a goal that differs there is not a harder level — it is a level that can
  // never be solved. The core already knows how to say why.
  if (world && goal) {
    const different = sameExercise(world, goal);
    if (different) {
      errors.push(`goal: not the same exercise as world — ${different}`);
    }
  }

  const solution = data.solution;
  if (typeof solution !== "string" || solution.trim() === "") {
    errors.push("solution: required — a program that reaches the goal");
  }

  if (data.program !== undefined && typeof data.program !== "string") {
    errors.push("program: must be a string when present");
  }

  if (errors.length > 0 || !title || !brief || !world || !goal) {
    return { ok: false, errors };
  }

  const level: Level = {
    id: id as string,
    difficulty: difficulty as Difficulty,
    order: order as number,
    author: (author as string).trim(),
    title,
    brief,
    world,
    goal,
    solution: solution as string,
  };
  if (data.ignoreFacing === true) {
    level.ignoreFacing = true;
  }
  if (typeof data.program === "string") {
    level.program = data.program;
  }
  return { ok: true, errors: [], level };
}

// ── Loading the folder ────────────────────────────────────────────────────

/**
 * Every file in `apps/web/levels/`, inlined at build time.
 *
 * Eager, because the collection is a few dozen kilobytes and a lazy import
 * would make the level list itself asynchronous for no gain.
 */
const FILES = import.meta.glob<{ default: unknown }>("../levels/*.json", { eager: true });

/** `../levels/corridor.json` → `corridor.json`. */
function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * Read the folder, or throw.
 *
 * Exported so the tests can run the identical load against the identical
 * files: the assertion that the collection is well formed is worth nothing if
 * the test checks a different copy of the rules than the app does.
 */
export function loadLevels(files: Record<string, { default: unknown }>): Level[] {
  const levels: Level[] = [];
  const seen = new Map<string, string>();

  for (const path of Object.keys(files).sort()) {
    const file = basename(path);
    const result = validateLevel(files[path]?.default);
    if (!result.ok || !result.level) {
      throw new Error(`levels/${file} is not a valid level:\n  ${result.errors.join("\n  ")}`);
    }
    const level = result.level;

    // The id is the file name, so a level has exactly one address whether you
    // reach it from a URL, a test failure or a `git log`.
    if (`${level.id}.json` !== file) {
      throw new Error(`levels/${file} declares id "${level.id}"; rename one to match the other`);
    }
    const clash = seen.get(level.id);
    if (clash) {
      throw new Error(`levels/${file} and levels/${clash} share the id "${level.id}"`);
    }
    seen.set(level.id, file);
    levels.push(level);
  }

  return sortLevels(levels);
}

/** Difficulty band first, then the file's own `order`, then id. */
export function sortLevels(levels: Level[]): Level[] {
  return [...levels].sort(
    (a, b) =>
      DIFFICULTIES.indexOf(a.difficulty) - DIFFICULTIES.indexOf(b.difficulty) ||
      a.order - b.order ||
      a.id.localeCompare(b.id)
  );
}

/** The collection, in the order it is shown. */
export const LEVELS: readonly Level[] = loadLevels(FILES);

export function levelById(id: string): Level | undefined {
  return LEVELS.find((level) => level.id === id);
}

export interface LevelGroup {
  difficulty: Difficulty;
  levels: Level[];
}

/**
 * The collection grouped for display. Empty bands are dropped, so a
 * difficulty nobody has written a level for yet does not show as a bare
 * heading.
 */
export function levelGroups(levels: readonly Level[] = LEVELS): LevelGroup[] {
  return DIFFICULTIES.map((difficulty) => ({
    difficulty,
    levels: levels.filter((level) => level.difficulty === difficulty),
  })).filter((group) => group.levels.length > 0);
}

// ── Reading a level ───────────────────────────────────────────────────────

/**
 * The text for the language on screen, falling back to English.
 *
 * Called at render time rather than stored, for the same reason the built-in
 * exercises use getters: anything that keeps the result has kept a string in
 * one language, and switching language will not re-word it.
 */
export function localised(text: LocalisedText): string {
  return text[currentLocale()] ?? text.en;
}

export function levelTitle(level: Level): string {
  return localised(level.title);
}

export function levelBrief(level: Level): string {
  return localised(level.brief);
}

/** The program the editor opens with for this level. */
export function startingProgram(level: Level): string {
  return level.program ?? PROGRAM_SKELETON;
}

// ── The verdict ───────────────────────────────────────────────────────────

/**
 * Did this run solve the level?
 *
 * Returns null when it did, or one already-translated sentence naming the
 * first difference — "3 beepers were expected at (5, 1), there are 2". Both
 * halves come from the core, which is what makes this the same check the CLI
 * runs: `sameExercise` catches a world that is not even the right exercise
 * (a resized map, an edited wall), `compareWorlds` compares the parts a
 * program can actually change.
 *
 * The goal is pushed through `World` first for the same reason the CLI does
 * it: that is the normalising step, and comparing a normalised world against
 * a raw one is how two equal worlds end up looking different.
 */
export function checkLevel(level: Level, world: KarelMap): string | null {
  const notThisExercise = sameExercise(world, level.goal);
  if (notThisExercise) {
    return notThisExercise;
  }
  return compareWorlds(new World(level.goal).toJSON(), world, {
    ignoreFacing: level.ignoreFacing === true,
  });
}

// ── Progress ──────────────────────────────────────────────────────────────

const SOLVED_KEY = "karel.levels.solved";

/**
 * Which levels this visitor has solved.
 *
 * Ids rather than a count, because the collection grows: a stored "7 of 12"
 * means nothing once a thirteenth file lands, while a set of ids survives
 * levels being added, renamed or removed. Storage can throw outright in a
 * private window, and losing a tick is not worth failing a page load over.
 */
export function loadSolved(): Set<string> {
  try {
    const raw = localStorage.getItem(SOLVED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) {
      return new Set();
    }
    return new Set(parsed.filter((id): id is string => typeof id === "string"));
  } catch {
    return new Set();
  }
}

export function saveSolved(solved: ReadonlySet<string>): void {
  try {
    localStorage.setItem(SOLVED_KEY, JSON.stringify([...solved].sort()));
  } catch {
    // Out of quota, or storage denied. The tick still shows for this visit.
  }
}

/** Record a solve. Returns the new set, so a caller can render from it. */
export function markSolved(id: string): Set<string> {
  const solved = loadSolved();
  solved.add(id);
  saveSolved(solved);
  return solved;
}
