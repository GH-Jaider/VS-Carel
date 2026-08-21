/**
 * LEARN mode: the language, one chapter at a time.
 *
 * A chapter is a lesson, a world, and a world the way it has to look when the
 * program stops. The last of those is the whole design: a chapter is not
 * "solved" because the reader pressed run and something happened, it is solved
 * because the final world matches the goal — and the comparison is
 * `compareWorlds` from the core, the same function the command line grades
 * submitted programs with. Passing a chapter here and failing the identical
 * check there is the one outcome a teaching tool cannot afford, so there is no
 * second implementation of "is this right" anywhere in the app.
 *
 * Everything a chapter says is a key into i18n.ts, read through a getter at
 * the moment it is asked for, exactly as the exercises in worlds.ts do it.
 * Anything that stores a title or a paragraph has stored one language; ask the
 * chapter again after the locale changes instead.
 *
 * The code in a chapter — the samples in the lesson, the starting program, the
 * reference solution — is never translated, because `pickbeeper` is what you
 * type in either language.
 *
 * The reference solutions are not decoration. tests/curriculum.test.ts runs
 * every one of them against its own world and fails the build unless the check
 * comes back clean, which is what makes "no chapter here is impossible" a
 * checked claim rather than a hope.
 */

import {
  compareWorlds,
  sameExercise,
  validateKarelMap,
  type CompareOptions,
  type KarelMap,
} from "@karel/core";
import { t, type MessageKey } from "./i18n.js";

// ── The shape of a chapter ────────────────────────────────────────────────

/**
 * A piece of a lesson. Prose is translated; code is not, and is meant to be
 * painted by the same tokenizer that paints the editor and the manual.
 */
export type LessonBlock = { kind: "prose"; text: string } | { kind: "code"; source: string };

export interface Chapter {
  /** Stable: it keys the message catalogue and the reader's saved progress. */
  id: string;
  /** The chapter's name, in the language on screen right now. */
  readonly title: string;
  /**
   * One sentence saying what has to be true when the program stops.
   *
   * `compareWorlds` explains the first thing that is *wrong*, which is only
   * useful to someone who already knows what right looks like. This is that.
   */
  readonly task: string;
  /** The lesson, ready to render: prose already translated, code as written. */
  readonly lesson: LessonBlock[];
  /** One or two, for a reader who is stuck. Shown on request, never up front. */
  readonly hints: string[];
  /** The world the chapter starts in. Treat as read-only. */
  world: KarelMap;
  /** The world the program has to produce. Treat as read-only. */
  goal: KarelMap;
  /**
   * Accept any final facing.
   *
   * Set wherever the task says where Karel must end up and not which way he
   * must look, which is most of them: failing a correct program over a detail
   * the task never asked for teaches nothing. Left off where the turn is the
   * point of the exercise.
   */
  ignoreFacing?: boolean;
  /** What the editor opens with: a skeleton, or code with a hole in it. */
  program: string;
  /** A program that solves the chapter. The tests prove that it does. */
  solution: string;
}

// ── Checking ──────────────────────────────────────────────────────────────

/**
 * Is this chapter solved? Returns null when it is, or one sentence naming the
 * first difference, already in the language on screen.
 *
 * The point of it is that main.ts never handles CompareOptions: which chapters
 * care about the final facing is a property of the chapter, decided here, and
 * a caller that had to remember to pass it would eventually forget.
 *
 * `sameExercise` runs first even though a chapter's two worlds are built from
 * one another below. It costs nothing, and it is the check that would catch a
 * world that reached this function from somewhere it should not have.
 */
export function checkChapter(chapter: Chapter, finalWorld: KarelMap): string | null {
  const mismatch = sameExercise(finalWorld, chapter.goal);
  if (mismatch) {
    return mismatch;
  }
  const options: CompareOptions = { ignoreFacing: chapter.ignoreFacing ?? false };
  return compareWorlds(chapter.goal, finalWorld, options);
}

// ── Building the chapters ─────────────────────────────────────────────────

type RawBlock = { kind: "prose"; key: MessageKey } | { kind: "code"; source: string };

interface ChapterSpec {
  id: string;
  titleKey: MessageKey;
  taskKey: MessageKey;
  lesson: RawBlock[];
  hintKeys: MessageKey[];
  world: KarelMap;
  goal: KarelMap;
  ignoreFacing?: boolean;
  program: string;
  solution: string;
}

function prose(key: MessageKey): RawBlock {
  return { kind: "prose", key };
}

function code(source: string): RawBlock {
  return { kind: "code", source };
}

function world(source: unknown): KarelMap {
  const result = validateKarelMap(source);
  if (!result.ok || !result.map) {
    // A chapter world that does not validate is a bug in this file rather than
    // bad input, and it should surface when the module loads, not when someone
    // reaches chapter nine.
    throw new Error(`chapter world is invalid: ${result.errors.join(", ")}`);
  }
  return result.map;
}

/**
 * The goal world, described as the changes a correct program makes.
 *
 * Dimensions and walls are copied from the starting world rather than typed
 * out again, because no instruction can change either: a goal that disagreed
 * about them would not be a hard chapter, it would be an impossible one, and
 * `sameExercise` would rightly refuse to grade it at all.
 */
function goalOf(
  start: KarelMap,
  karel: Partial<KarelMap["karel"]>,
  beepers: KarelMap["beepers"]
): KarelMap {
  return world({
    dimensions: { ...start.dimensions },
    karel: { ...start.karel, ...karel },
    beepers,
    walls: start.walls.map((w) => ({ from: { ...w.from }, to: { ...w.to } })),
  });
}

/** One beeper on each of the given corners. */
function ones(corners: [number, number][]): KarelMap["beepers"] {
  return corners.map(([x, y]) => ({ x, y, count: 1 }));
}

function chapter(spec: ChapterSpec): Chapter {
  return {
    id: spec.id,
    get title() {
      return t(spec.titleKey);
    },
    get task() {
      return t(spec.taskKey);
    },
    get lesson(): LessonBlock[] {
      return spec.lesson.map((block) =>
        block.kind === "prose" ? { kind: "prose", text: t(block.key) } : block
      );
    },
    get hints() {
      return spec.hintKeys.map((key) => t(key));
    },
    world: spec.world,
    goal: spec.goal,
    ...(spec.ignoreFacing === undefined ? {} : { ignoreFacing: spec.ignoreFacing }),
    program: spec.program,
    solution: spec.solution,
  };
}

/** Wrap a body in the frame every program has. */
function program(body: string, definitions = ""): string {
  return [
    "BEGINNING-OF-PROGRAM",
    ...(definitions ? [indent(definitions, 1), ""] : []),
    "    BEGINNING-OF-EXECUTION",
    indent(body, 2),
    "    END-OF-EXECUTION",
    "END-OF-PROGRAM",
    "",
  ].join("\n");
}

function indent(source: string, levels: number): string {
  const pad = "    ".repeat(levels);
  return source
    .split("\n")
    .map((line) => (line.trim() === "" ? "" : pad + line))
    .join("\n");
}

const TURNRIGHT = `DEFINE-NEW-INSTRUCTION turnright AS
BEGIN
    turnleft;
    turnleft;
    turnleft
END`;

const HARVEST = `DEFINE-NEW-INSTRUCTION harvest AS
BEGIN
    WHILE next-to-a-beeper DO
    BEGIN
        pickbeeper
    END
END`;

const SWEEP_LINE = `DEFINE-NEW-INSTRUCTION sweep-line AS
BEGIN
    harvest;
    WHILE front-is-clear DO
    BEGIN
        move;
        harvest
    END
END`;

const LAY_SIDE = `DEFINE-NEW-INSTRUCTION lay-side AS
BEGIN
    ITERATE 4 TIMES
    BEGIN
        putbeeper;
        move
    END
    turnleft
END`;

// ── The worlds ────────────────────────────────────────────────────────────
//
// Small on purpose. A chapter's world has to fit on a phone and say what it is
// about at a glance; a corridor of six corners teaches WHILE exactly as well
// as a corridor of forty, and it can be read without scrolling.

const MOVE_WORLD = world({
  dimensions: { width: 6, height: 3 },
  karel: { x: 1, y: 1, facing: "east", beepers: 0 },
  beepers: [],
  walls: [],
});

const TURN_WORLD = world({
  dimensions: { width: 5, height: 5 },
  karel: { x: 1, y: 1, facing: "east", beepers: 0 },
  beepers: [],
  walls: [],
});

const BAG_WORLD = world({
  dimensions: { width: 7, height: 3 },
  karel: { x: 1, y: 1, facing: "east", beepers: 0 },
  beepers: [{ x: 3, y: 1, count: 1 }],
  walls: [],
});

const DEFINE_WORLD = world({
  dimensions: { width: 5, height: 5 },
  karel: { x: 1, y: 1, facing: "north", beepers: 0 },
  beepers: [],
  walls: [],
});

const ITERATE_WORLD = world({
  dimensions: { width: 8, height: 3 },
  karel: { x: 1, y: 1, facing: "east", beepers: 5 },
  beepers: [],
  walls: [],
});

// The wall is what front-is-clear is for: three corners of clear road and then
// a stop that no amount of counting would survive on a different map.
const CONDITION_WORLD = world({
  dimensions: { width: 6, height: 3 },
  karel: { x: 1, y: 1, facing: "east", beepers: 0 },
  beepers: [{ x: 4, y: 1, count: 1 }],
  walls: [{ from: { x: 4, y: 1 }, to: { x: 5, y: 1 } }],
});

const WHILE_WORLD = world({
  dimensions: { width: 8, height: 3 },
  karel: { x: 1, y: 1, facing: "east", beepers: 0 },
  beepers: [{ x: 6, y: 1, count: 1 }],
  walls: [{ from: { x: 6, y: 1 }, to: { x: 7, y: 1 } }],
});

const ELSE_WORLD = world({
  dimensions: { width: 6, height: 3 },
  karel: { x: 1, y: 1, facing: "east", beepers: 3 },
  beepers: ones([
    [1, 1],
    [3, 1],
    [5, 1],
  ]),
  walls: [],
});

// A pile on the corner he starts on, so a loop that only deals with the
// corners it walks onto is visibly one beeper short before it is two.
const PILES_WORLD = world({
  dimensions: { width: 8, height: 3 },
  karel: { x: 1, y: 1, facing: "east", beepers: 0 },
  beepers: [
    { x: 1, y: 1, count: 2 },
    { x: 2, y: 1, count: 1 },
    { x: 4, y: 1, count: 3 },
    { x: 5, y: 1, count: 2 },
    { x: 6, y: 1, count: 1 },
  ],
  walls: [{ from: { x: 6, y: 1 }, to: { x: 7, y: 1 } }],
});

// Sixteen corners on the rim of a 5 by 5 world, and sixteen beepers in the
// bag: the count is part of the exercise, so it is exact.
const BORDER_WORLD = world({
  dimensions: { width: 5, height: 5 },
  karel: { x: 1, y: 1, facing: "east", beepers: 16 },
  beepers: [],
  walls: [],
});

const BORDER_CORNERS: [number, number][] = [
  [1, 1],
  [2, 1],
  [3, 1],
  [4, 1],
  [5, 1],
  [5, 2],
  [5, 3],
  [5, 4],
  [5, 5],
  [4, 5],
  [3, 5],
  [2, 5],
  [1, 5],
  [1, 4],
  [1, 3],
  [1, 2],
];

const SWEEP_WORLD = world({
  dimensions: { width: 6, height: 6 },
  karel: { x: 1, y: 1, facing: "east", beepers: 0 },
  beepers: [
    { x: 3, y: 1, count: 2 },
    { x: 6, y: 1, count: 1 },
    { x: 6, y: 3, count: 1 },
    { x: 6, y: 5, count: 3 },
  ],
  walls: [],
});

// ── The chapters ──────────────────────────────────────────────────────────
//
// The order is the teaching, and it is the one constraint on this list: every
// chapter may use what the ones before it introduced and nothing else. Adding
// a chapter in the middle means checking that claim again by hand.

const SPECS: ChapterSpec[] = [
  {
    id: "move",
    titleKey: "learn.move.title",
    taskKey: "learn.move.task",
    lesson: [
      prose("learn.move.p1"),
      code(program("move;\nturnoff")),
      prose("learn.move.p2"),
      prose("learn.move.p3"),
    ],
    hintKeys: ["learn.move.hint1", "learn.move.hint2"],
    world: MOVE_WORLD,
    goal: goalOf(MOVE_WORLD, { x: 4, y: 1 }, []),
    ignoreFacing: true,
    program: program("move;\nturnoff"),
    solution: program("move;\nmove;\nmove;\nturnoff"),
  },

  {
    id: "turn",
    titleKey: "learn.turn.title",
    taskKey: "learn.turn.task",
    lesson: [
      prose("learn.turn.p1"),
      code("move;\nturnleft;\nmove"),
      prose("learn.turn.p2"),
      prose("learn.turn.p3"),
    ],
    hintKeys: ["learn.turn.hint1", "learn.turn.hint2"],
    world: TURN_WORLD,
    goal: goalOf(TURN_WORLD, { x: 3, y: 3 }, []),
    ignoreFacing: true,
    program: program("move;\nmove;\nturnoff"),
    solution: program("move;\nmove;\nturnleft;\nmove;\nmove;\nturnoff"),
  },

  {
    id: "bag",
    titleKey: "learn.bag.title",
    taskKey: "learn.bag.task",
    lesson: [
      prose("learn.bag.p1"),
      code("pickbeeper;\nmove;\nputbeeper"),
      prose("learn.bag.p2"),
      prose("learn.bag.p3"),
    ],
    hintKeys: ["learn.bag.hint1", "learn.bag.hint2"],
    world: BAG_WORLD,
    goal: goalOf(BAG_WORLD, { x: 5, y: 1, beepers: 0 }, ones([[5, 1]])),
    ignoreFacing: true,
    program: program("move;\nturnoff"),
    solution: program("move;\nmove;\npickbeeper;\nmove;\nmove;\nputbeeper;\nturnoff"),
  },

  {
    id: "define",
    titleKey: "learn.define.title",
    taskKey: "learn.define.task",
    lesson: [
      prose("learn.define.p1"),
      code(TURNRIGHT),
      prose("learn.define.p2"),
      prose("learn.define.p3"),
    ],
    hintKeys: ["learn.define.hint1", "learn.define.hint2"],
    world: DEFINE_WORLD,
    goal: goalOf(DEFINE_WORLD, { x: 3, y: 3, facing: "east" }, []),
    ignoreFacing: true,
    program: program(
      "move;\nmove;\nturnright;\nturnoff",
      `DEFINE-NEW-INSTRUCTION turnright AS
BEGIN
    turnleft
    // two more turns are missing
END`
    ),
    solution: program("move;\nmove;\nturnright;\nmove;\nmove;\nturnoff", TURNRIGHT),
  },

  {
    id: "iterate",
    titleKey: "learn.iterate.title",
    taskKey: "learn.iterate.task",
    lesson: [
      prose("learn.iterate.p1"),
      code("ITERATE 4 TIMES\nBEGIN\n    move\nEND"),
      prose("learn.iterate.p2"),
      prose("learn.iterate.p3"),
    ],
    hintKeys: ["learn.iterate.hint1", "learn.iterate.hint2"],
    world: ITERATE_WORLD,
    goal: goalOf(
      ITERATE_WORLD,
      { x: 5, y: 1, beepers: 0 },
      ones([
        [1, 1],
        [2, 1],
        [3, 1],
        [4, 1],
        [5, 1],
      ])
    ),
    ignoreFacing: true,
    program: program("ITERATE 4 TIMES\nBEGIN\n    putbeeper\nEND\nturnoff"),
    solution: program("ITERATE 4 TIMES\nBEGIN\n    putbeeper;\n    move\nEND\nputbeeper;\nturnoff"),
  },

  {
    id: "conditions",
    titleKey: "learn.conditions.title",
    taskKey: "learn.conditions.task",
    lesson: [
      prose("learn.conditions.p1"),
      prose("learn.conditions.p2"),
      code("IF front-is-clear THEN\nBEGIN\n    move\nEND"),
      prose("learn.conditions.p3"),
    ],
    hintKeys: ["learn.conditions.hint1", "learn.conditions.hint2"],
    world: CONDITION_WORLD,
    goal: goalOf(CONDITION_WORLD, { x: 4, y: 1, beepers: 1 }, []),
    ignoreFacing: true,
    program: program("ITERATE 5 TIMES\nBEGIN\n    move\nEND\nturnoff"),
    solution: program(
      `ITERATE 5 TIMES
BEGIN
    IF front-is-clear THEN
    BEGIN
        move
    END
END
pickbeeper;
turnoff`
    ),
  },

  {
    id: "while",
    titleKey: "learn.while.title",
    taskKey: "learn.while.task",
    lesson: [
      prose("learn.while.p1"),
      code("WHILE front-is-clear DO\nBEGIN\n    move\nEND"),
      prose("learn.while.p2"),
      prose("learn.while.p3"),
    ],
    hintKeys: ["learn.while.hint1", "learn.while.hint2"],
    world: WHILE_WORLD,
    goal: goalOf(WHILE_WORLD, { x: 6, y: 1, beepers: 1 }, []),
    ignoreFacing: true,
    program: program("WHILE front-is-clear DO\nBEGIN\n    move\nEND\nturnoff"),
    solution: program("WHILE front-is-clear DO\nBEGIN\n    move\nEND\npickbeeper;\nturnoff"),
  },

  {
    id: "else",
    titleKey: "learn.else.title",
    taskKey: "learn.else.task",
    lesson: [
      prose("learn.else.p1"),
      code(
        `IF next-to-a-beeper THEN
BEGIN
    pickbeeper
END
ELSE
BEGIN
    putbeeper
END`
      ),
      prose("learn.else.p2"),
      prose("learn.else.p3"),
    ],
    hintKeys: ["learn.else.hint1", "learn.else.hint2"],
    world: ELSE_WORLD,
    goal: goalOf(
      ELSE_WORLD,
      { x: 6, y: 1, beepers: 3 },
      ones([
        [2, 1],
        [4, 1],
        [6, 1],
      ])
    ),
    ignoreFacing: true,
    program: program(
      `ITERATE 6 TIMES
BEGIN
    IF next-to-a-beeper THEN
    BEGIN
        pickbeeper
    END
    // and when the corner is empty?
    IF front-is-clear THEN
    BEGIN
        move
    END
END
turnoff`
    ),
    solution: program(
      `ITERATE 6 TIMES
BEGIN
    IF next-to-a-beeper THEN
    BEGIN
        pickbeeper
    END
    ELSE
    BEGIN
        putbeeper
    END
    IF front-is-clear THEN
    BEGIN
        move
    END
END
turnoff`
    ),
  },

  {
    id: "piles",
    titleKey: "learn.piles.title",
    taskKey: "learn.piles.task",
    lesson: [
      prose("learn.piles.p1"),
      code(HARVEST),
      prose("learn.piles.p2"),
      prose("learn.piles.p3"),
    ],
    hintKeys: ["learn.piles.hint1", "learn.piles.hint2"],
    world: PILES_WORLD,
    goal: goalOf(PILES_WORLD, { x: 6, y: 1, beepers: 9 }, []),
    ignoreFacing: true,
    program: program(
      `WHILE front-is-clear DO
BEGIN
    move;
    IF next-to-a-beeper THEN
    BEGIN
        pickbeeper
    END
END
turnoff`
    ),
    solution: program(
      `harvest;
WHILE front-is-clear DO
BEGIN
    move;
    harvest
END
turnoff`,
      HARVEST
    ),
  },

  {
    id: "border",
    titleKey: "learn.border.title",
    taskKey: "learn.border.task",
    lesson: [
      prose("learn.border.p1"),
      code(LAY_SIDE),
      prose("learn.border.p2"),
      prose("learn.border.p3"),
    ],
    hintKeys: ["learn.border.hint1", "learn.border.hint2"],
    world: BORDER_WORLD,
    goal: goalOf(BORDER_WORLD, { x: 1, y: 1, facing: "east", beepers: 0 }, ones(BORDER_CORNERS)),
    // The one chapter that grades the final facing. Four sides and four left
    // turns bring him back exactly as he set out, and saying so is the last
    // paragraph of the lesson — it is the point being made, not a trap.
    ignoreFacing: false,
    program: program(
      "lay-side;\nturnoff",
      `DEFINE-NEW-INSTRUCTION lay-side AS
BEGIN
    ITERATE 4 TIMES
    BEGIN
        putbeeper;
        move
    END
    // he is on the corner now: which way should he look?
END`
    ),
    solution: program("ITERATE 4 TIMES\nBEGIN\n    lay-side\nEND\nturnoff", LAY_SIDE),
  },

  {
    id: "sweep",
    titleKey: "learn.sweep.title",
    taskKey: "learn.sweep.task",
    lesson: [
      prose("learn.sweep.p1"),
      prose("learn.sweep.p2"),
      code(SWEEP_LINE),
      prose("learn.sweep.p3"),
      prose("learn.sweep.p4"),
    ],
    hintKeys: ["learn.sweep.hint1", "learn.sweep.hint2"],
    world: SWEEP_WORLD,
    goal: goalOf(SWEEP_WORLD, { x: 6, y: 6, beepers: 0 }, [{ x: 6, y: 6, count: 7 }]),
    ignoreFacing: true,
    program: program("harvest;\nturnoff", HARVEST),
    solution: program(
      `sweep-line;
turnleft;
sweep-line;
WHILE beeper-in-bag DO
BEGIN
    putbeeper
END
turnoff`,
      `${HARVEST}\n\n${SWEEP_LINE}`
    ),
  },
];

/** The book, in reading order. */
export const CHAPTERS: Chapter[] = SPECS.map(chapter);

/**
 * Every message key the curriculum reads, so a test can hold each catalogue to
 * all of them at once. Derived from the specs rather than written out again: a
 * list maintained by hand would be the first thing to fall behind, and it is
 * the thing doing the checking.
 */
export const CURRICULUM_KEYS: readonly MessageKey[] = SPECS.flatMap((spec) => [
  spec.titleKey,
  spec.taskKey,
  ...spec.hintKeys,
  ...spec.lesson.filter((b) => b.kind === "prose").map((b) => b.key),
]);

// ── Navigation ────────────────────────────────────────────────────────────

export const FIRST_CHAPTER_ID = CHAPTERS[0].id;

export function chapterById(id: string): Chapter {
  return CHAPTERS.find((c) => c.id === id) ?? CHAPTERS[0];
}

/** 0-based, or -1 for an id nothing answers to. Useful for "3 of 11". */
export function chapterIndex(id: string): number {
  return CHAPTERS.findIndex((c) => c.id === id);
}

/** The chapter after this one, or null at the end of the book. */
export function nextChapter(id: string): Chapter | null {
  const at = chapterIndex(id);
  return at >= 0 && at + 1 < CHAPTERS.length ? CHAPTERS[at + 1] : null;
}

// ── Progress ──────────────────────────────────────────────────────────────

/**
 * What the reader has done, kept apart from the sandbox workspace in
 * worlds.ts. They are different things with different lifetimes: clearing one
 * must not clear the other, and a half-written sandbox program has no business
 * appearing in chapter three.
 */
export interface LearnProgress {
  /** Chapter ids whose check has come back clean. */
  solved: string[];
  /** The chapter they were reading. */
  current: string;
  /** What they had typed, per chapter, so a chapter reopens where they left it. */
  programs: Record<string, string>;
}

const STORAGE_KEY = "karel.learn";

export function defaultProgress(): LearnProgress {
  return { solved: [], current: FIRST_CHAPTER_ID, programs: {} };
}

/**
 * Always a usable object, never null: a caller that has to handle "no progress
 * yet" separately handles it differently in each of the three places it asks.
 *
 * Storage can throw outright rather than come back empty — a private window,
 * or a browser set to block site data — and none of this is worth failing a
 * page load for. Unknown chapter ids are dropped on the way in, so a chapter
 * removed from the book does not leave a reader pointing at nothing.
 */
export function loadProgress(): LearnProgress {
  const fallback = defaultProgress();
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return fallback;
  }
  if (!raw) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<LearnProgress>;
    const known = new Set(CHAPTERS.map((c) => c.id));
    const solved = Array.isArray(parsed.solved)
      ? parsed.solved.filter((id): id is string => typeof id === "string" && known.has(id))
      : [];
    const current =
      typeof parsed.current === "string" && known.has(parsed.current)
        ? parsed.current
        : fallback.current;
    const programs: Record<string, string> = {};
    if (parsed.programs && typeof parsed.programs === "object") {
      for (const [id, source] of Object.entries(parsed.programs)) {
        if (known.has(id) && typeof source === "string") {
          programs[id] = source;
        }
      }
    }
    return { solved, current, programs };
  } catch {
    return fallback;
  }
}

export function saveProgress(progress: LearnProgress): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // Out of quota, or storage denied. The chapter still works; it just will
    // not be here tomorrow.
  }
}

/** Record a chapter as solved, without duplicating an id already there. */
export function markSolved(progress: LearnProgress, id: string): LearnProgress {
  if (progress.solved.includes(id)) {
    return progress;
  }
  return { ...progress, solved: [...progress.solved, id] };
}

/** What the editor should open with: what they left, or the chapter's start. */
export function programFor(chapter: Chapter, progress: LearnProgress): string {
  return progress.programs[chapter.id] ?? chapter.program;
}
