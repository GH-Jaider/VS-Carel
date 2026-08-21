/**
 * Characterization tests for the execution machine (interpreter + execution frames).
 *
 * These pin down behaviour that already works: how each built-in mutates the
 * world, which RuntimeErrorKind travels up from an error shutoff, and how the
 * step / recursion / spin budgets end a runaway program.
 *
 * Everything is driven with step() rather than run(): step() is synchronous and
 * timer-free, while run() sleeps at least MIN_SPEED_MS (10ms) between steps.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { Direction, Interpreter, RuntimeError, World, validateKarelMap } from "../src/index";
import type { KarelMap } from "../src/index";

/** A 5x5 world with Karel in the middle, so every direction is clear. */
function makeWorld(overrides: Partial<KarelMap> = {}): World {
  return new World({
    dimensions: { width: 5, height: 5 },
    karel: { x: 3, y: 3, facing: "north", beepers: 0 },
    beepers: [],
    walls: [],
    ...overrides,
  });
}

/** Wrap a body in the program/execution scaffolding the parser requires. */
function program(body: string, definitions = ""): string {
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

/**
 * 1-based line holding `marker`. Line assertions are written against a comment
 * marker instead of a literal number so that editing the fixture source above
 * the failing statement cannot silently invalidate the expectation.
 */
function lineOf(source: string, marker: string): number {
  const index = source.split("\n").findIndex((line) => line.includes(marker));
  expect(index, `marker ${marker} not found in source`).toBeGreaterThanOrEqual(0);
  return index + 1;
}

interface Capture {
  steps: number[];
  errors: RuntimeError[];
  completions: number;
}

/** Record every callback the interpreter fires, in order. */
function capture(interpreter: Interpreter): Capture {
  const captured: Capture = { steps: [], errors: [], completions: 0 };
  interpreter.onStep = (line) => captured.steps.push(line);
  interpreter.onError = (error) => captured.errors.push(error);
  interpreter.onComplete = () => {
    captured.completions += 1;
  };
  return captured;
}

function stepToEnd(interpreter: Interpreter): void {
  while (interpreter.step()) {
    // step() returns false on turnoff, on an error shutoff and when the
    // statement list runs out, so this always terminates.
  }
}

/** Load a program, assert it parsed cleanly, and hook up the callbacks. */
function start(
  source: string,
  world = makeWorld(),
  options?: { maxSteps?: number }
): { world: World; interpreter: Interpreter; captured: Capture } {
  const interpreter = new Interpreter(world, options);
  const diagnostics = interpreter.load(source);
  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  return { world, interpreter, captured: capture(interpreter) };
}

describe("built-in instructions", () => {
  it("moves Karel one cell in the direction she is facing", () => {
    const { world, interpreter, captured } = start(program("move;\nturnoff"));

    stepToEnd(interpreter);

    expect(world.karel.position).toEqual({ x: 3, y: 4 });
    expect(captured.errors).toEqual([]);
  });

  it("turns Karel counter-clockwise on turnleft", () => {
    const { world, interpreter } = start(program("turnleft;\nturnleft;\nturnoff"));

    stepToEnd(interpreter);

    expect(world.karel.facing).toBe(Direction.South);
  });

  it("moves a beeper from the corner into the bag on pickbeeper", () => {
    const world = makeWorld({ beepers: [{ x: 3, y: 3, count: 2 }] });
    const { interpreter } = start(program("pickbeeper;\nturnoff"), world);

    stepToEnd(interpreter);

    expect(world.getBeepers({ x: 3, y: 3 })).toBe(1);
    expect(world.karel.beepersInBag).toBe(1);
  });

  it("moves a beeper from the bag onto the corner on putbeeper", () => {
    const world = makeWorld({ karel: { x: 3, y: 3, facing: "north", beepers: 2 } });
    const { interpreter } = start(program("putbeeper;\nturnoff"), world);

    stepToEnd(interpreter);

    expect(world.getBeepers({ x: 3, y: 3 })).toBe(1);
    expect(world.karel.beepersInBag).toBe(1);
  });

  it("finishes the program on turnoff and reports completion exactly once", () => {
    const { interpreter, captured } = start(program("move;\nturnoff"));

    stepToEnd(interpreter);

    expect(interpreter.isFinished).toBe(true);
    expect(captured.completions).toBe(1);
    expect(captured.errors).toEqual([]);
    // A finished interpreter is inert: no extra work, no second onComplete.
    expect(interpreter.step()).toBe(false);
    expect(captured.completions).toBe(1);
  });

  it("runs a whole program to turnoff through the animated run() loop", async () => {
    const { world, interpreter, captured } = start(program("move;\nmove;\nturnoff"));
    interpreter.setSpeed(0); // clamped up to MIN_SPEED_MS, keeping the test short

    await interpreter.run();

    expect(world.karel.position).toEqual({ x: 3, y: 5 });
    expect(captured.completions).toBe(1);
    expect(interpreter.isFinished).toBe(true);
  });
});

describe("error shutoffs", () => {
  it("reports a blocked move as kind 'blocked' on the offending line", () => {
    const source = program("turnleft;\nturnleft;\nturnleft;\nturnleft;\nmove; // boom\nturnoff");
    const world = makeWorld({ walls: [{ from: { x: 3, y: 3 }, to: { x: 3, y: 4 } }] });
    const { interpreter, captured } = start(source, world);

    stepToEnd(interpreter);

    expect(captured.errors).toHaveLength(1);
    expect(captured.errors[0]).toBeInstanceOf(RuntimeError);
    expect(captured.errors[0].kind).toBe("blocked");
    expect(captured.errors[0].line).toBe(lineOf(source, "// boom"));
    // The four turns happened; the blocked move left Karel where she was.
    expect(world.karel.position).toEqual({ x: 3, y: 3 });
    expect(captured.completions).toBe(0);
  });

  it("reports picking from an empty corner as kind 'no-beeper'", () => {
    const source = program("move;\npickbeeper; // boom\nturnoff");
    const { world, interpreter, captured } = start(source);

    stepToEnd(interpreter);

    expect(captured.errors[0].kind).toBe("no-beeper");
    expect(captured.errors[0].line).toBe(lineOf(source, "// boom"));
    expect(captured.errors[0].message).toContain("(3, 4)");
    expect(world.karel.beepersInBag).toBe(0);
  });

  it("reports putting from an empty bag as kind 'empty-bag'", () => {
    const source = program("putbeeper; // boom\nturnoff");
    const { world, interpreter, captured } = start(source);

    stepToEnd(interpreter);

    expect(captured.errors[0].kind).toBe("empty-bag");
    expect(captured.errors[0].line).toBe(lineOf(source, "// boom"));
    expect(world.getBeepers({ x: 3, y: 3 })).toBe(0);
  });

  it("stops the program at the first shutoff instead of throwing out of step()", () => {
    const { interpreter, captured } = start(program("putbeeper;\nmove;\nturnoff"));

    // No expect().toThrow(): once the program is running, failures reach the
    // caller through onError and step() simply reports "nothing more to run".
    expect(interpreter.step()).toBe(false);
    expect(captured.errors).toHaveLength(1);
    expect(captured.steps).toEqual([]);
    expect(interpreter.isFinished).toBe(true);
  });
});

describe("execution limits", () => {
  it("honours the maxSteps option instead of the built-in default", () => {
    const source = program("WHILE front-is-clear DO turnleft;");
    const { interpreter, captured } = start(source, makeWorld(), { maxSteps: 50 });

    stepToEnd(interpreter);

    expect(captured.steps).toHaveLength(50);
    expect(captured.errors[0].kind).toBe("limit");
    expect(captured.errors[0].message).toContain("50");
    expect(captured.errors[0].message).not.toContain("100000");
  });

  it("stops an instruction that calls itself forever with kind 'limit'", () => {
    const source = program(
      "spin;\nturnoff",
      "DEFINE-NEW-INSTRUCTION spin AS\nBEGIN\nspin // recurses\nEND"
    );
    const { interpreter, captured } = start(source);

    stepToEnd(interpreter);

    expect(captured.errors[0].kind).toBe("limit");
    expect(captured.errors[0].message).toContain("spin");
    expect(captured.errors[0].line).toBe(lineOf(source, "// recurses"));
    // The stack blows up while expanding, so not one visible step ever ran.
    expect(captured.steps).toEqual([]);
  });

  it("stops a loop that spins without any visible action, and does so promptly", () => {
    const source = program("WHILE front-is-clear DO\nBEGIN\nEND\nturnoff");
    const { interpreter, captured } = start(source);

    const startedAt = Date.now();
    stepToEnd(interpreter);
    const elapsed = Date.now() - startedAt;

    expect(captured.errors[0].kind).toBe("limit");
    // Thrown by the internal-spin budget, which has no instruction to blame.
    expect(captured.errors[0].line).toBeUndefined();
    expect(captured.steps).toEqual([]);
    expect(elapsed).toBeLessThan(3_000);
  });
});

describe("stepping semantics", () => {
  it("executes exactly one visible instruction per step, expansion being free", () => {
    const source = program(
      "turnright; // call\nturnoff",
      "DEFINE-NEW-INSTRUCTION turnright AS\nBEGIN\nturnleft; // first\nturnleft;\nturnleft\nEND"
    );
    const { world, interpreter, captured } = start(source);

    expect(interpreter.isStarted).toBe(false);

    // Expanding turnright does not consume the step: the very first step()
    // already performed the first turnleft of the body.
    expect(interpreter.step()).toBe(true);
    expect(world.karel.facing).toBe(Direction.West);
    expect(captured.steps).toEqual([lineOf(source, "// first")]);
    expect(interpreter.isStarted).toBe(true);

    interpreter.step();
    interpreter.step();
    expect(world.karel.facing).toBe(Direction.East);
    expect(captured.steps).toHaveLength(3);

    // Fourth step is turnoff, reported on the call line in the main block.
    expect(interpreter.step()).toBe(false);
    expect(captured.steps).toHaveLength(4);
    expect(captured.completions).toBe(1);
  });

  it("fires onStep after the instruction ran, with the world already in sync", () => {
    const source = program("move; // the move\nturnoff");
    const world = makeWorld();
    const interpreter = new Interpreter(world);
    interpreter.load(source);

    const seen: Array<{ line: number; y: number }> = [];
    interpreter.onStep = (line) => seen.push({ line, y: world.karel.position.y });

    interpreter.step();

    expect(seen).toEqual([{ line: lineOf(source, "// the move"), y: 4 }]);
  });
});

describe("loading a program", () => {
  it("returns parser diagnostics and still executes the best-effort AST", () => {
    const source = program("move;\nbogus; // unknown\nturnoff");
    const interpreter = new Interpreter(makeWorld());

    const diagnostics = interpreter.load(source);

    expect(diagnostics.some((d) => d.severity === "error" && d.message.includes("bogus"))).toBe(
      true
    );

    // load() never throws and never refuses: refusing to run is the caller's
    // job, so a program with errors still runs until it reaches the bad call.
    const captured = capture(interpreter);
    stepToEnd(interpreter);

    expect(captured.steps).toHaveLength(1);
    expect(captured.errors[0].kind).toBe("unknown-name");
    expect(captured.errors[0].line).toBe(lineOf(source, "// unknown"));
  });

  it("throws kind 'internal' when stepping with no program loaded", () => {
    const interpreter = new Interpreter(makeWorld());

    // Nothing is running yet, so this one really does throw at the caller.
    expect(() => interpreter.step()).toThrow(RuntimeError);
    try {
      interpreter.step();
      expect.unreachable("step() should have thrown");
    } catch (error) {
      expect((error as RuntimeError).kind).toBe("internal");
    }
  });

  it("throws kind 'internal' when the source was too broken to produce an AST", async () => {
    const interpreter = new Interpreter(makeWorld());

    const diagnostics = interpreter.load("   ");
    expect(diagnostics[0].severity).toBe("error");

    // An empty source yields no AST at all, which is indistinguishable from
    // "never loaded" at run time.
    await expect(interpreter.run()).rejects.toThrow(RuntimeError);
  });
});

describe("the shipped example program", () => {
  it("runs against the shipped world and reaches turnoff", () => {
    const raw: unknown = JSON.parse(
      readFileSync(new URL("../../../examples/simple-world.klm", import.meta.url), "utf8")
    );
    const validation = validateKarelMap(raw);
    expect(validation.ok).toBe(true);

    const source = readFileSync(
      new URL("../../../examples/demo-program.kli", import.meta.url),
      "utf8"
    );
    const { world, interpreter, captured } = start(source, new World(validation.map!));

    stepToEnd(interpreter);

    // The demo takes the ELSE branch (no beeper at (2,3)), drops one there,
    // then walks back down to the bottom row and turns off.
    expect(world.getBeepers({ x: 2, y: 3 })).toBe(1);
    expect(world.karel.beepersInBag).toBe(4);
    expect(world.karel.position).toEqual({ x: 2, y: 1 });
    expect(captured.steps).toHaveLength(13);
    expect(captured.errors).toHaveLength(0);
    expect(captured.completions).toBe(1);
  });
});
