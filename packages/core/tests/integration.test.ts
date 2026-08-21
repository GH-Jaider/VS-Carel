/**
 * End-to-end tests over the fixtures the project actually ships.
 *
 * Everything here goes through the whole pipeline — validate the .klm, parse
 * the .kli, execute to the shutoff — so a regression anywhere in the core shows
 * up as the shipped example behaving differently than it is documented to.
 */

import { describe, expect, it } from "vitest";

import { Interpreter, Parser, World, validateKarelMap } from "../src/index";
import type { Diagnostic, KarelMap } from "../src/index";
import {
  DEMO_PROGRAM_SOURCE,
  capture,
  readSimpleWorldMap,
  stepToEnd,
  type Capture,
} from "./helpers";

interface RunOutcome {
  world: World;
  /** step() calls that returned true, i.e. instructions with more program after them. */
  drivenSteps: number;
  /** Every callback the run fired: the onStep line trace, errors and completions. */
  captured: Capture;
}

/** Build a fresh World from the fixture map and run the demo to exhaustion. */
function runDemo(): RunOutcome {
  const validation = validateKarelMap(readSimpleWorldMap());
  if (!validation.ok || !validation.map) {
    throw new Error(`fixture map is invalid: ${validation.errors.join(", ")}`);
  }

  const world = new World(validation.map);
  const interpreter = new Interpreter(world);
  const diagnostics = interpreter.load(DEMO_PROGRAM_SOURCE);
  if (diagnostics.some((d) => d.severity === "error")) {
    throw new Error(`fixture program failed to parse: ${diagnostics[0].message}`);
  }

  const captured = capture(interpreter);
  const drivenSteps = stepToEnd(interpreter);
  return { world, drivenSteps, captured };
}

describe("the shipped fixtures", () => {
  it("accepts simple-world.klm as a valid map", () => {
    const result = validateKarelMap(readSimpleWorldMap());

    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.map).toMatchObject({
      dimensions: { width: 10, height: 8 },
      karel: { x: 1, y: 1, facing: "north", beepers: 5 },
    });
    expect(result.map?.beepers).toHaveLength(3);
    expect(result.map?.walls).toHaveLength(5);
  });

  it("parses demo-program.kli without a single error diagnostic", () => {
    const { ast, diagnostics } = new Parser().parse(DEMO_PROGRAM_SOURCE);

    const errors = diagnostics.filter((d: Diagnostic) => d.severity === "error");
    expect(errors).toEqual([]);
    expect(ast).not.toBeNull();
    // Both DEFINE-NEW-INSTRUCTION blocks must survive, including move-to-wall,
    // which the execution block never calls.
    expect(ast?.definitions.map((d) => d.name)).toEqual(["turnright", "move-to-wall"]);
  });
});

describe("running demo-program.kli on simple-world.klm", () => {
  it("leaves Karel and the beepers exactly where the demo is meant to leave them", () => {
    const final = runDemo().world.toJSON();

    // Only Karel and the beeper stacks can change: the language has no
    // instruction that builds a wall or resizes the world, so pinning those
    // here would only make an unrelated edit to the fixture rewrite this test.
    expect(final.karel).toEqual({ x: 2, y: 1, facing: "south", beepers: 4 });
    expect(final.beepers).toEqual([
      { x: 3, y: 3, count: 2 },
      { x: 5, y: 5, count: 1 },
      { x: 8, y: 2, count: 3 },
      // The ELSE branch dropped one here; the three stacks above are untouched.
      { x: 2, y: 3, count: 1 },
    ]);
  });

  it("cannot touch the walls or the dimensions of the world it runs in", () => {
    const final = runDemo().world.toJSON();
    const initial = validateKarelMap(readSimpleWorldMap()).map!;

    expect(final.dimensions).toEqual(initial.dimensions);
    expect(final.walls).toEqual(initial.walls);
  });

  it("reaches turnoff cleanly", () => {
    const { captured } = runDemo();

    // The demo is the project's front-door example, so it has to finish: the
    // ITERATE walks Karel from y=3 back down to the bottom row and stops there.
    // If a change to the program or the world makes it hit a wall instead,
    // this is the test that says so.
    expect(captured.errors).toEqual([]);
    expect(captured.completions).toBe(1);
  });

  it("executes a deterministic number of visible steps", () => {
    const { drivenSteps, captured } = runDemo();

    // The two counts differ by one on purpose: onStep fires for turnoff, but
    // the step() call that runs it returns false to say the program is over,
    // so the driving loop never counts it.
    expect(drivenSteps).toBe(12);
    expect(captured.steps).toHaveLength(13);
    // Expanding a custom instruction is not a visible step, so `turnright` on
    // lines 18 and 28 shows up as the three turnleft lines of its body (4,5,6).
    expect(captured.steps).toEqual([16, 17, 4, 5, 6, 19, 26, 4, 5, 6, 31, 31, 33]);
  });

  it("is reproducible: a second run from the same map lands identically", () => {
    const first = runDemo();
    const second = runDemo();

    expect(second.world.toJSON()).toEqual(first.world.toJSON());
    expect(second.captured.steps).toEqual(first.captured.steps);
  });
});

describe("the .klm file is the initial state, never the running state", () => {
  it("does not mutate the parsed map object while executing", () => {
    const parsed = readSimpleWorldMap() as KarelMap;
    const pristine = readSimpleWorldMap() as KarelMap;

    const world = new World(validateKarelMap(parsed).map!);
    const interpreter = new Interpreter(world);
    interpreter.load(DEMO_PROGRAM_SOURCE);
    stepToEnd(interpreter);

    // Karel moved, dropped a beeper and emptied one bag slot in the World...
    expect(world.toJSON().karel).not.toEqual(parsed.karel);
    // ...while the object read from disk is exactly what it was.
    expect(parsed).toEqual(pristine);
  });

  it("hands the World a defensive copy, not the caller's own objects", () => {
    const parsed = readSimpleWorldMap() as KarelMap;
    const normalized = validateKarelMap(parsed).map!;

    // Sharing any node here would let a later World mutation leak back into
    // whatever the editor is holding as the saved map.
    expect(normalized).not.toBe(parsed);
    expect(normalized.karel).not.toBe(parsed.karel);
    expect(normalized.dimensions).not.toBe(parsed.dimensions);
    expect(normalized.beepers[0]).not.toBe(parsed.beepers[0]);
    expect(normalized.walls[0]).not.toBe(parsed.walls[0]);
    expect(normalized.walls[0].from).not.toBe(parsed.walls[0].from);
  });
});
