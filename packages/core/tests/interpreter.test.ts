/**
 * Characterization tests for the execution machine (interpreter + execution frames).
 *
 * These pin down behaviour that already works: how each built-in mutates the
 * world, how control flow drives the explicit stack, which RuntimeErrorKind
 * travels up from an error shutoff, and how the step / recursion / spin budgets
 * end a runaway program.
 *
 * The end-to-end run of the shipped fixtures lives in integration.test.ts,
 * which asserts the full trace and final world; nothing here reads examples/.
 */

import { describe, expect, it } from "vitest";

import { Direction, Interpreter, RuntimeError, World } from "../src/index";
// ErrorMessages is deliberately not public: hosts branch on RuntimeErrorKind,
// never on prose. Asserting against it checks *which* message was raised and
// how its arguments were filled in, without freezing the English wording.
import { ErrorMessages } from "../src/messages";
import { capture, makeWorld, program, stepToEnd, type Capture } from "./helpers";

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

describe("control flow", () => {
  it("runs the THEN branch and skips the ELSE branch when the condition holds", () => {
    const world = makeWorld({ beepers: [{ x: 3, y: 3, count: 1 }] });
    const source = program(
      "IF next-to-a-beeper THEN\nBEGIN\npickbeeper // taken\nEND\nELSE\nBEGIN\nmove\nEND\nturnoff"
    );
    const { interpreter, captured } = start(source, world);

    stepToEnd(interpreter);

    expect(world.karel.beepersInBag).toBe(1);
    expect(world.karel.position).toEqual({ x: 3, y: 3 }); // the ELSE move never ran
    expect(captured.steps).toEqual([lineOf(source, "// taken"), lineOf(source, "turnoff")]);
  });

  it("runs the ELSE branch and skips the THEN branch when the condition fails", () => {
    const world = makeWorld({ karel: { x: 3, y: 3, facing: "north", beepers: 1 } });
    const { interpreter, captured } = start(
      program("IF next-to-a-beeper THEN\nBEGIN\npickbeeper\nEND\nELSE\nBEGIN\nputbeeper\nEND\nturnoff"),
      world
    );

    stepToEnd(interpreter);

    expect(world.getBeepers({ x: 3, y: 3 })).toBe(1);
    expect(world.karel.beepersInBag).toBe(0);
    expect(captured.steps).toHaveLength(2); // putbeeper, then turnoff
  });

  it("executes nothing at all for an IF with no ELSE whose condition fails", () => {
    const world = makeWorld({ karel: { x: 3, y: 3, facing: "north", beepers: 0 } });
    const { interpreter, captured } = start(
      program("IF next-to-a-beeper THEN\nBEGIN\npickbeeper\nEND\nturnoff"),
      world
    );

    stepToEnd(interpreter);

    // Only turnoff runs: an empty ELSE must not leave a frame behind either.
    expect(captured.steps).toHaveLength(1);
    expect(captured.errors).toEqual([]);
    expect(captured.completions).toBe(1);
  });

  it("leaves a WHILE loop as soon as its condition turns false", () => {
    // Karel starts on the bottom row of a 5x5 world facing north, so the loop
    // runs exactly four times and then the border stops it.
    const world = makeWorld({ karel: { x: 1, y: 1, facing: "north", beepers: 0 } });
    const source = program("WHILE front-is-clear DO\nBEGIN\nmove // one pass\nEND\nturnoff");
    const { interpreter, captured } = start(source, world);

    stepToEnd(interpreter);

    expect(world.karel.position).toEqual({ x: 1, y: 5 });
    expect(captured.steps).toEqual([
      ...Array<number>(4).fill(lineOf(source, "// one pass")),
      lineOf(source, "turnoff"),
    ]);
    expect(captured.errors).toEqual([]);
    expect(captured.completions).toBe(1);
  });

  it("repeats an ITERATE body exactly the requested number of times", () => {
    const world = makeWorld({ karel: { x: 1, y: 1, facing: "north", beepers: 0 } });
    const { interpreter, captured } = start(
      program("ITERATE 3 TIMES\nBEGIN\nmove\nEND\nturnoff"),
      world
    );

    stepToEnd(interpreter);

    expect(world.karel.position).toEqual({ x: 1, y: 4 });
    expect(captured.steps).toHaveLength(4); // three moves plus turnoff
  });

  it("skips an ITERATE body entirely when the count is zero", () => {
    const { world, interpreter, captured } = start(
      program("ITERATE 0 TIMES\nBEGIN\nmove\nEND\nturnoff")
    );

    stepToEnd(interpreter);

    expect(world.karel.position).toEqual({ x: 3, y: 3 });
    expect(captured.steps).toHaveLength(1);
    expect(captured.completions).toBe(1);
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
    expect(captured.errors[0].message).toBe(ErrorMessages.moveBlocked());
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
    // The corner named in the message is where Karel stands after the move.
    expect(captured.errors[0].message).toBe(ErrorMessages.noBeepersToPickUp(3, 4));
    expect(world.karel.beepersInBag).toBe(0);
  });

  it("reports putting from an empty bag as kind 'empty-bag'", () => {
    const source = program("putbeeper; // boom\nturnoff");
    const { world, interpreter, captured } = start(source);

    stepToEnd(interpreter);

    expect(captured.errors[0].kind).toBe("empty-bag");
    expect(captured.errors[0].message).toBe(ErrorMessages.noBeepersInBag());
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

  it("stamps the IF line on an unknown condition, which the world cannot do itself", () => {
    // The parser flags the misspelling too, but a caller may run anyway, and
    // then the shutoff has to point somewhere useful.
    const source = program("IF front-is-lava THEN // boom\nmove;\nturnoff");
    const interpreter = new Interpreter(makeWorld());
    interpreter.load(source);
    const captured = capture(interpreter);

    stepToEnd(interpreter);

    expect(captured.errors[0].kind).toBe("unknown-name");
    expect(captured.errors[0].message).toBe(ErrorMessages.unknownCondition("front-is-lava"));
    expect(captured.errors[0].line).toBe(lineOf(source, "// boom"));
  });

  it("stamps the WHILE line on an unknown condition, which the frame carries for it", () => {
    const source = program("WHILE front-is-lava DO // boom\nmove;\nturnoff");
    const interpreter = new Interpreter(makeWorld());
    interpreter.load(source);
    const captured = capture(interpreter);

    stepToEnd(interpreter);

    expect(captured.errors[0].kind).toBe("unknown-name");
    expect(captured.errors[0].line).toBe(lineOf(source, "// boom"));
  });
});

describe("execution limits", () => {
  it("honours the maxSteps option instead of the built-in default", () => {
    const source = program("WHILE front-is-clear DO turnleft;");
    const { interpreter, captured } = start(source, makeWorld(), { maxSteps: 50 });

    stepToEnd(interpreter);

    expect(captured.steps).toHaveLength(50);
    expect(captured.errors[0].kind).toBe("limit");
    expect(captured.errors[0].message).toBe(ErrorMessages.maxIterationsReached(50));
  });

  it("falls back to the default budget when maxSteps could never stop a runaway", () => {
    // 0, a negative, NaN and Infinity would each disable the guard if taken at
    // face value, turning an infinite loop into a hang instead of an error.
    for (const maxSteps of [0, -1, NaN, Infinity]) {
      const { interpreter, captured } = start(program("WHILE front-is-clear DO turnleft;"), makeWorld(), {
        maxSteps,
      });

      stepToEnd(interpreter);

      expect(captured.errors[0].kind, `maxSteps: ${maxSteps}`).toBe("limit");
      expect(captured.errors[0].message, `maxSteps: ${maxSteps}`).toBe(
        ErrorMessages.maxIterationsReached(100_000)
      );
    }
  });

  it("floors a fractional maxSteps rather than letting it drift off by a fraction", () => {
    const { interpreter, captured } = start(
      program("WHILE front-is-clear DO turnleft;"),
      makeWorld(),
      { maxSteps: 2.5 }
    );

    stepToEnd(interpreter);

    expect(captured.steps).toHaveLength(2);
    expect(captured.errors[0].message).toBe(ErrorMessages.maxIterationsReached(2));
  });

  it("stops an instruction that calls itself forever with kind 'limit'", () => {
    const source = program(
      "spin;\nturnoff",
      "DEFINE-NEW-INSTRUCTION spin AS\nBEGIN\nspin // recurses\nEND"
    );
    const { interpreter, captured } = start(source);

    stepToEnd(interpreter);

    expect(captured.errors[0].kind).toBe("limit");
    expect(captured.errors[0].message).toBe(ErrorMessages.recursionTooDeep("spin"));
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
    expect(captured.errors[0].message).toBe(ErrorMessages.stuckWithoutProgress());
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

describe("pausing and resuming", () => {
  it("leaves the program suspended, not finished, when stop() interrupts run()", async () => {
    const { world, interpreter, captured } = start(program("WHILE front-is-clear DO turnleft;"));
    interpreter.setSpeed(0); // clamped up to MIN_SPEED_MS

    const running = interpreter.run();
    // run() executes synchronously up to its first delay, so exactly one step
    // has happened by the time this line runs.
    interpreter.stop();
    await running;

    expect(captured.steps).toHaveLength(1);
    expect(captured.errors).toEqual([]);
    expect(captured.completions).toBe(0);
    // A stop is a pause: the step budget and the world both survive it.
    expect(interpreter.isFinished).toBe(false);
    expect(world.karel.facing).toBe(Direction.West);
  });

  it("carries on from where it stopped, rather than restarting the program", async () => {
    const { world, interpreter, captured } = start(program("move;\nmove;\nmove;\nturnoff"));
    interpreter.setSpeed(0);

    const running = interpreter.run();
    interpreter.stop();
    await running;
    expect(world.karel.position).toEqual({ x: 3, y: 4 });

    // Resuming must not re-run the first move: ensureInitialized only builds
    // the stack once, and step() clears the pending stop request.
    stepToEnd(interpreter);

    expect(world.karel.position).toEqual({ x: 3, y: 5 }); // the border stopped her
    expect(captured.errors[0].kind).toBe("blocked");
    expect(captured.steps).toHaveLength(2);
  });

  it("ignores a second run() while one is already looping", async () => {
    const { interpreter, captured } = start(program("WHILE front-is-clear DO turnleft;"));
    interpreter.setSpeed(0);

    const first = interpreter.run();
    // The re-entrancy guard is what keeps a double-click on the host's Run
    // button from driving the same stack twice as fast.
    const second = interpreter.run();
    interpreter.stop();
    await Promise.all([first, second]);

    expect(captured.steps).toHaveLength(1);
  });
});

describe("loading a program", () => {
  it("returns parser diagnostics and still executes the best-effort AST", () => {
    const source = program("move;\nbogus; // unknown\nturnoff");
    const interpreter = new Interpreter(makeWorld());

    const diagnostics = interpreter.load(source);

    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        message: ErrorMessages.unknownInstruction("bogus"),
        severity: "error",
      })
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
    try {
      interpreter.step();
      expect.unreachable("step() should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(RuntimeError);
      expect((error as RuntimeError).kind).toBe("internal");
      expect((error as RuntimeError).message).toBe(ErrorMessages.programNotLoaded());
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
