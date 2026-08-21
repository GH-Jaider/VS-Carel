/**
 * Scaffolding shared by the core test suites.
 *
 * Only what more than one suite needs lives here. Anything a single suite uses
 * stays next to the tests that read it: a helper one file away costs a jump,
 * and that is only worth paying when it removes a real duplicate.
 *
 * Nothing here asserts. Helpers that fail a test from a distance make the
 * failure report point at this file instead of at the test that broke.
 */

import { readFileSync } from "node:fs";

import { World } from "../src/index";
import type { Interpreter, KarelMap, RuntimeError } from "../src/index";

/**
 * The fixtures live at the repo root so the extension, the web app and these
 * tests all exercise the exact same files a student would open. Reading them
 * (rather than inlining a copy) makes every suite a regression test on the
 * shipped examples.
 */
function readExample(name: string): string {
  return readFileSync(new URL(`../../../examples/${name}`, import.meta.url), "utf8");
}

export const DEMO_PROGRAM_SOURCE = readExample("demo-program.kli");
export const SIMPLE_WORLD_SOURCE = readExample("simple-world.klm");

/**
 * A fresh parse of the map fixture on every call, so a test that hands the
 * object to World (or mutates it on purpose) cannot leak into the next one.
 */
export function readSimpleWorldMap(): unknown {
  return JSON.parse(SIMPLE_WORLD_SOURCE);
}

/** A 5x5 map with Karel in the middle, so every direction starts out clear. */
export function makeMap(overrides: Partial<KarelMap> = {}): KarelMap {
  return {
    dimensions: { width: 5, height: 5 },
    karel: { x: 3, y: 3, facing: "north", beepers: 0 },
    beepers: [],
    walls: [],
    ...overrides,
  };
}

export function makeWorld(overrides: Partial<KarelMap> = {}): World {
  return new World(makeMap(overrides));
}

/**
 * Wrap statements in the boilerplate every Karel program needs. The body lands
 * on line 3 when there are no definitions, which is what line assertions in the
 * suites are written against.
 */
export function program(body: string, definitions = ""): string {
  return [
    "BEGINNING-OF-PROGRAM",
    definitions,
    "BEGINNING-OF-EXECUTION",
    body,
    "END-OF-EXECUTION",
    "END-OF-PROGRAM",
  ]
    .filter((part) => part !== "")
    .join("\n");
}

export interface Capture {
  /** Source line reported by onStep, one entry per visible instruction. */
  steps: number[];
  errors: RuntimeError[];
  completions: number;
}

/** Record every callback the interpreter fires, in order. */
export function capture(interpreter: Interpreter): Capture {
  const captured: Capture = { steps: [], errors: [], completions: 0 };
  interpreter.onStep = (line) => captured.steps.push(line);
  interpreter.onError = (error) => captured.errors.push(error);
  interpreter.onComplete = () => {
    captured.completions += 1;
  };
  return captured;
}

/**
 * Drive the interpreter with step() rather than run(): step() is synchronous
 * and timer-free, while run() sleeps at least MIN_SPEED_MS between steps.
 *
 * Returns the number of step() calls that returned true. That is one less than
 * the number of executed instructions whenever the program ends on turnoff:
 * the step that runs turnoff returns false to say the program is over.
 */
export function stepToEnd(interpreter: Interpreter): number {
  let steps = 0;
  // step() returns false on turnoff, on an error shutoff and when the statement
  // list runs out, so this always terminates.
  while (interpreter.step()) {
    steps++;
  }
  return steps;
}
