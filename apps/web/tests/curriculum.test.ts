/**
 * The curriculum, held to its own promises.
 *
 * A chapter is a claim: "this program, in this world, produces that world".
 * Prose cannot be checked, but that claim can be, and it is the one thing in
 * LEARN mode that must never be wrong — a chapter nobody can solve is worse
 * than no chapter at all, because the reader assumes the fault is theirs and
 * stops.
 *
 * So the centre of this file is one test that runs every reference solution
 * against its own starting world and demands that `checkChapter` comes back
 * clean. Everything else guards the edges of the same claim: that the worlds
 * are legal, that a goal belongs to the exercise it grades, that the code the
 * editor opens with parses, and that the chapter is not already solved before
 * the reader has typed anything.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  Interpreter,
  Parser,
  World,
  sameExercise,
  validateKarelMap,
  type KarelMap,
} from "@karel/core";

import {
  CHAPTERS,
  CURRICULUM_KEYS,
  FIRST_CHAPTER_ID,
  chapterById,
  chapterIndex,
  checkChapter,
  defaultProgress,
  loadProgress,
  markSolved,
  nextChapter,
  programFor,
  type Chapter,
} from "../src/curriculum";
import { CATALOGUES, LOCALES, setLocale, type Locale } from "../src/i18n";

/** A program that loops forever must fail this test, not hang it. */
const STEP_BUDGET = 5_000;

interface RunResult {
  world: KarelMap;
  error: string | null;
}

/**
 * Run a program to a standstill, the way the page does but without the
 * animation: one visible step at a time until there are none left.
 */
function run(map: KarelMap, source: string): RunResult {
  const world = new World(map);
  const interpreter = new Interpreter(world);
  const diagnostics = interpreter.load(source);
  const blocking = diagnostics.filter((d) => d.severity === "error");
  if (blocking.length > 0) {
    return { world: world.toJSON(), error: blocking.map((d) => d.message).join("; ") };
  }

  let error: string | null = null;
  interpreter.onError = (e) => {
    error = e.message;
  };
  let steps = 0;
  while (interpreter.step()) {
    if (++steps > STEP_BUDGET) {
      return { world: world.toJSON(), error: `did not stop within ${STEP_BUDGET} steps` };
    }
  }
  return { world: world.toJSON(), error };
}

function diagnose(source: string) {
  return new Parser().parse(source).diagnostics;
}

function each(fn: (chapter: Chapter) => void): void {
  for (const chapter of CHAPTERS) {
    fn(chapter);
  }
}

afterEach(() => {
  // Several tests read a chapter in Spanish. Anything after them would
  // otherwise be reading a page in whichever language ran last.
  setLocale("en");
});

describe("the book", () => {
  it("is long enough to teach the language and short enough to finish", () => {
    expect(CHAPTERS.length).toBeGreaterThanOrEqual(8);
    expect(CHAPTERS.length).toBeLessThanOrEqual(12);
  });

  it("gives every chapter its own id", () => {
    const ids = CHAPTERS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("reads in order, first to last", () => {
    expect(FIRST_CHAPTER_ID).toBe(CHAPTERS[0].id);
    for (const [at, chapter] of CHAPTERS.entries()) {
      expect(chapterIndex(chapter.id)).toBe(at);
      expect(chapterById(chapter.id)).toBe(chapter);
      const after = nextChapter(chapter.id);
      expect(after?.id ?? null).toBe(at + 1 < CHAPTERS.length ? CHAPTERS[at + 1].id : null);
    }
  });

  it("falls back to the first chapter for an id nobody answers to", () => {
    // A stale link or a stale localStorage entry must not open a blank page.
    expect(chapterById("no-such-chapter")).toBe(CHAPTERS[0]);
    expect(chapterIndex("no-such-chapter")).toBe(-1);
  });
});

describe("the worlds", () => {
  it("are legal .klm maps, both the start and the goal", () => {
    each((chapter) => {
      expect(validateKarelMap(chapter.world), `${chapter.id}: start`).toMatchObject({ ok: true });
      expect(validateKarelMap(chapter.goal), `${chapter.id}: goal`).toMatchObject({ ok: true });
    });
  });

  it("grades each chapter against a goal from the same exercise", () => {
    // Dimensions and walls are the parts no instruction can reach. A goal that
    // disagreed about either would not be a hard chapter, it would be an
    // ungradable one — and the failure is dangerous rather than loud: a
    // program that happened to end on the right corner would pass against a
    // key for a different problem.
    each((chapter) => {
      expect(sameExercise(chapter.world, chapter.goal), chapter.id).toBeNull();
    });
  });

  it("asks for something the starting world is not already", () => {
    each((chapter) => {
      const difference = checkChapter(chapter, chapter.world);
      expect(difference, `${chapter.id}: nothing to do`).not.toBeNull();
    });
  });
});

describe("the reference solutions", () => {
  it("parse without a single complaint", () => {
    each((chapter) => {
      expect(diagnose(chapter.solution), chapter.id).toEqual([]);
    });
  });

  /**
   * The test this file exists for. If one of these ever fails, a chapter has
   * become impossible and no amount of good prose will save the reader.
   */
  it("solve their own chapter", () => {
    each((chapter) => {
      const result = run(chapter.world, chapter.solution);
      expect(result.error, `${chapter.id}: ran badly`).toBeNull();
      const difference = checkChapter(chapter, result.world);
      expect(difference, `${chapter.id}: did not reach the goal`).toBeNull();
    });
  });

  it("are not just the program the editor opens with", () => {
    each((chapter) => {
      expect(chapter.solution.trim(), chapter.id).not.toBe(chapter.program.trim());
    });
  });
});

describe("the starting programs", () => {
  it("parse without errors or warnings", () => {
    // Warnings count here too: the problems panel is part of the lesson, and a
    // chapter that opens with a complaint the reader did not cause teaches
    // them to ignore the panel.
    each((chapter) => {
      expect(diagnose(chapter.program), chapter.id).toEqual([]);
    });
  });

  it("leave the chapter unsolved", () => {
    // Either they stop short of the goal or they fail outright — chapter six
    // opens with a program that walks into a wall on purpose. What none of
    // them may do is pass, which would mark the chapter solved before the
    // reader had read it.
    each((chapter) => {
      const result = run(chapter.world, chapter.program);
      const solved = result.error === null && checkChapter(chapter, result.world) === null;
      expect(solved, `${chapter.id}: solved before it was opened`).toBe(false);
    });
  });
});

describe("checking a chapter", () => {
  it("says what is wrong, in the language on screen", () => {
    const chapter = CHAPTERS[0];
    setLocale("en");
    const english = checkChapter(chapter, chapter.world);
    setLocale("es");
    const spanish = checkChapter(chapter, chapter.world);
    expect(english).toBeTruthy();
    expect(spanish).toBeTruthy();
    expect(spanish).not.toBe(english);
  });

  it("ignores the final facing exactly where the chapter says to", () => {
    each((chapter) => {
      const turned: KarelMap = {
        ...chapter.goal,
        karel: {
          ...chapter.goal.karel,
          facing: chapter.goal.karel.facing === "north" ? "west" : "north",
        },
      };
      const difference = checkChapter(chapter, turned);
      if (chapter.ignoreFacing) {
        expect(difference, `${chapter.id}: should not care about the facing`).toBeNull();
      } else {
        expect(difference, `${chapter.id}: should care about the facing`).not.toBeNull();
      }
    });
  });

  it("refuses a world from another exercise even when it looks right", () => {
    const chapter = CHAPTERS[0];
    const elsewhere: KarelMap = {
      ...chapter.goal,
      dimensions: {
        width: chapter.goal.dimensions.width + 1,
        height: chapter.goal.dimensions.height,
      },
    };
    expect(checkChapter(chapter, elsewhere)).not.toBeNull();
  });

  it("at least one chapter grades the facing, or the lesson is never taught", () => {
    expect(CHAPTERS.some((c) => c.ignoreFacing !== true)).toBe(true);
  });
});

describe("what a chapter says", () => {
  it("is written in every language the page offers", () => {
    for (const { id } of LOCALES) {
      for (const key of CURRICULUM_KEYS) {
        expect(CATALOGUES[id as Locale][key], `${id}: ${key}`).toBeTypeOf("string");
        expect(CATALOGUES[id as Locale][key].trim(), `${id}: ${key}`).not.toBe("");
      }
    }
  });

  it("reads back in whichever language is current", () => {
    for (const { id } of LOCALES) {
      setLocale(id);
      each((chapter) => {
        expect(chapter.title.trim(), `${id}: ${chapter.id} title`).not.toBe("");
        expect(chapter.task.trim(), `${id}: ${chapter.id} task`).not.toBe("");
        expect(chapter.hints.length, `${id}: ${chapter.id} hints`).toBeGreaterThan(0);
        for (const hint of chapter.hints) {
          expect(hint.trim(), `${id}: ${chapter.id} hint`).not.toBe("");
        }
        const prose = chapter.lesson.filter((b) => b.kind === "prose");
        expect(prose.length, `${id}: ${chapter.id} lesson`).toBeGreaterThanOrEqual(2);
        for (const block of chapter.lesson) {
          const text = block.kind === "prose" ? block.text : block.source;
          expect(text.trim(), `${id}: ${chapter.id} block`).not.toBe("");
        }
      });
    }
  });

  it("changes language when the page does", () => {
    setLocale("en");
    const english = CHAPTERS.map((c) => c.title);
    setLocale("es");
    const spanish = CHAPTERS.map((c) => c.title);
    expect(spanish).not.toEqual(english);
  });

  it("shows code the parser understands", () => {
    // A sample in a lesson is read as instruction. One the parser would reject
    // teaches a typo, and the reader has no way of knowing which of you is
    // wrong.
    //
    // Samples are fragments, so each is put back inside a program frame
    // together with whatever the chapter's own editor already defines — which
    // is the context the reader reads it in. That is how `sweep-line` is
    // allowed to call `harvest`: the chapter opens with `harvest` on screen.
    each((chapter) => {
      for (const block of chapter.lesson) {
        if (block.kind !== "code") {
          continue;
        }
        const source = /BEGINNING-OF-PROGRAM/i.test(block.source)
          ? block.source
          : wrap(block.source, definitionsIn(chapter.program));
        const errors = diagnose(source).filter((d) => d.severity === "error");
        expect(errors, `${chapter.id}: ${block.source.split("\n")[0]}`).toEqual([]);
      }
    });
  });
});

/** Whatever a program defines before BEGINNING-OF-EXECUTION. */
function definitionsIn(source: string): string {
  const opens = source.indexOf("BEGINNING-OF-PROGRAM");
  const executes = source.indexOf("BEGINNING-OF-EXECUTION");
  if (opens < 0 || executes < 0) {
    return "";
  }
  return source.slice(opens + "BEGINNING-OF-PROGRAM".length, executes);
}

/** Put a fragment back inside the frame every program has. */
function wrap(source: string, context = ""): string {
  const isDefinition = /^\s*DEFINE-NEW-INSTRUCTION/i.test(source);
  return [
    "BEGINNING-OF-PROGRAM",
    context,
    isDefinition ? source : "",
    "BEGINNING-OF-EXECUTION",
    isDefinition ? "turnoff" : `${source};\nturnoff`,
    "END-OF-EXECUTION",
    "END-OF-PROGRAM",
  ].join("\n");
}

describe("progress", () => {
  it("starts at the first chapter", () => {
    expect(defaultProgress().current).toBe(FIRST_CHAPTER_ID);
    expect(defaultProgress().solved).toEqual([]);
  });

  it("survives having no storage at all", () => {
    // There is no localStorage in node, which is the same shape of failure as
    // a browser that refuses one: the accessor itself throws.
    expect(loadProgress()).toEqual(defaultProgress());
  });

  it("records a chapter once, however many times it is solved", () => {
    const once = markSolved(defaultProgress(), FIRST_CHAPTER_ID);
    const twice = markSolved(once, FIRST_CHAPTER_ID);
    expect(once.solved).toEqual([FIRST_CHAPTER_ID]);
    expect(twice).toBe(once);
  });

  it("opens a chapter where the reader left it", () => {
    const chapter = CHAPTERS[0];
    expect(programFor(chapter, defaultProgress())).toBe(chapter.program);
    const saved = { ...defaultProgress(), programs: { [chapter.id]: "half-written" } };
    expect(programFor(chapter, saved)).toBe("half-written");
  });
});
