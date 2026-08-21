/**
 * The two commands, as pure functions over already-read file contents.
 *
 * Nothing here touches the filesystem, process.exit or the console: each
 * command returns a Result that main.ts renders and turns into an exit code.
 * That keeps the grading semantics — what counts as a pass — testable without
 * spawning a process, and it is the reason the exit-code mapping lives in
 * exactly one place.
 */

import {
  Interpreter,
  Parser,
  RuntimeError,
  World,
  type Diagnostic,
  type KarelMap,
  type RuntimeErrorKind,
} from "@karel/core";

export interface Failure {
  kind: RuntimeErrorKind | "assert-world";
  message: string;
  line?: number;
}

export interface RunResult {
  command: "run";
  /** Visible instructions executed before the program stopped. */
  steps: number;
  /** The world as it stood when execution ended, however it ended. */
  world: KarelMap;
  /** Parse warnings. Errors never get here: they end the run before it starts. */
  diagnostics: Diagnostic[];
  failure?: Failure;
}

export interface CheckResult {
  command: "check";
  diagnostics: Diagnostic[];
}

/** A parse that produced errors, so nothing ran. */
export interface ParseFailure {
  command: "parse-failed";
  diagnostics: Diagnostic[];
}

export type Result = RunResult | CheckResult | ParseFailure;

/** Parse `source` without executing it. */
export function check(source: string): CheckResult {
  return { command: "check", diagnostics: new Parser().parse(source).diagnostics };
}

export interface RunOptions {
  source: string;
  map: KarelMap;
  maxSteps?: number;
  /** Expected final world. Compared after a clean finish, never after an error. */
  expected?: KarelMap;
}

export function run({ source, map, maxSteps, expected }: RunOptions): RunResult | ParseFailure {
  const world = new World(map);
  const interpreter = new Interpreter(world, maxSteps === undefined ? undefined : { maxSteps });

  const diagnostics = interpreter.load(source);
  if (diagnostics.some((d) => d.severity === "error")) {
    return { command: "parse-failed", diagnostics };
  }

  let steps = 0;
  let failure: Failure | undefined;
  let completed = false;

  // Count from onStep, which fires only once an instruction has actually run.
  // The step() return value cannot do this job: it is false both for the
  // turnoff that ends a good program (which did execute) and for the
  // instruction that hit a wall (which did not). This counter therefore
  // matches the interpreter's own, and so matches what --max-steps compares
  // against — the number a teacher reads off a reference solution.
  interpreter.onStep = () => {
    steps++;
  };
  interpreter.onError = (error) => {
    failure = { kind: error.kind, message: error.message, line: error.line };
  };
  interpreter.onComplete = () => {
    completed = true;
  };

  try {
    while (interpreter.step()) {
      // Driving only; the count comes from onStep.
    }
  } catch (error) {
    // step() throws for failures raised before the program is under way —
    // no program loaded, an empty execution block — while everything after
    // that arrives through onError. Both are the same thing to a grader.
    failure ??= toFailure(error);
  }

  const result: RunResult = { command: "run", steps, world: world.toJSON(), diagnostics };
  if (failure) {
    result.failure = failure;
    return result;
  }

  // Only worth comparing a world the program actually finished building. After
  // a shutoff the mismatch is a consequence of the error, not a second finding.
  if (expected && completed) {
    const mismatch = compareWorlds(new World(expected).toJSON(), result.world);
    if (mismatch) {
      result.failure = { kind: "assert-world", message: mismatch };
    }
  }

  return result;
}

function toFailure(error: unknown): Failure {
  if (error instanceof RuntimeError) {
    return { kind: error.kind, message: error.message, line: error.line };
  }
  return { kind: "internal", message: error instanceof Error ? error.message : String(error) };
}

/**
 * Compare the parts of a world a program can change, and describe the first
 * difference in the terms a student would use — "a beeper at (3, 4)", not a
 * JSON diff. Dimensions and walls are skipped on purpose: no instruction can
 * alter them, so a mismatch there means the two files describe different
 * exercises, which `validateKarelMap` cannot catch and a diff would only
 * bury among real findings.
 */
function compareWorlds(expected: KarelMap, actual: KarelMap): string | null {
  const e = expected.karel;
  const a = actual.karel;

  if (e.x !== a.x || e.y !== a.y) {
    return `expected Karel at (${e.x}, ${e.y}), found (${a.x}, ${a.y})`;
  }
  if (e.facing !== a.facing) {
    return `expected Karel facing ${e.facing}, found ${a.facing}`;
  }
  if (e.beepers !== a.beepers) {
    return `expected ${plural(e.beepers, "beeper")} in the bag, found ${a.beepers}`;
  }

  const expectedPiles = pileMap(expected);
  const actualPiles = pileMap(actual);
  for (const [corner, count] of expectedPiles) {
    const found = actualPiles.get(corner) ?? 0;
    if (found !== count) {
      return `expected ${plural(count, "beeper")} at ${corner}, found ${found}`;
    }
  }
  for (const [corner, count] of actualPiles) {
    if (!expectedPiles.has(corner)) {
      return `expected no beepers at ${corner}, found ${plural(count, "beeper")}`;
    }
  }

  return null;
}

function pileMap(map: KarelMap): Map<string, number> {
  return new Map(map.beepers.filter((b) => b.count > 0).map((b) => [`(${b.x}, ${b.y})`, b.count]));
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
