import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  Interpreter,
  Parser,
  RuntimeError,
  World,
  validateKarelMap,
  type Diagnostic,
  type KarelMap,
} from "../src/index";

// The fixtures live at the repo root so the extension, the web app and the
// core tests all exercise the exact same files a student would open.
const MAP_SOURCE = readFileSync(
  new URL("../../../examples/simple-world.klm", import.meta.url),
  "utf8"
);
const PROGRAM_SOURCE = readFileSync(
  new URL("../../../examples/demo-program.kli", import.meta.url),
  "utf8"
);

interface RunOutcome {
  world: World;
  /** Source line reported by onStep, one entry per visible instruction. */
  trace: number[];
  /** step() calls that returned true, i.e. instructions actually executed. */
  steps: number;
  error: RuntimeError | null;
  completed: boolean;
}

/** Build a fresh World from the fixture map and run the demo to exhaustion. */
function runDemo(): RunOutcome {
  const validation = validateKarelMap(JSON.parse(MAP_SOURCE));
  if (!validation.ok || !validation.map) {
    throw new Error(`fixture map is invalid: ${validation.errors.join(", ")}`);
  }

  const world = new World(validation.map);
  const interpreter = new Interpreter(world);
  const diagnostics = interpreter.load(PROGRAM_SOURCE);
  if (diagnostics.some((d) => d.severity === "error")) {
    throw new Error(`fixture program failed to parse: ${diagnostics[0].message}`);
  }

  const outcome: RunOutcome = { world, trace: [], steps: 0, error: null, completed: false };
  interpreter.onStep = (line) => outcome.trace.push(line);
  interpreter.onError = (error) => (outcome.error = error);
  interpreter.onComplete = () => (outcome.completed = true);

  while (interpreter.step()) {
    outcome.steps++;
  }
  return outcome;
}

describe("the shipped fixtures", () => {
  it("accepts simple-world.klm as a valid map", () => {
    const result = validateKarelMap(JSON.parse(MAP_SOURCE));

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
    const { ast, diagnostics } = new Parser().parse(PROGRAM_SOURCE);

    const errors = diagnostics.filter((d: Diagnostic) => d.severity === "error");
    expect(errors).toEqual([]);
    expect(ast).not.toBeNull();
    // Both DEFINE-NEW-INSTRUCTION blocks must survive, including move-to-wall,
    // which the execution block never calls.
    expect(ast?.definitions.map((d) => d.name)).toEqual(["turnright", "move-to-wall"]);
  });
});

describe("running demo-program.kli on simple-world.klm", () => {
  it("leaves the world in a stable, fully described final state", () => {
    const { world } = runDemo();

    expect(world.toJSON()).toMatchInlineSnapshot(`
      {
        "beepers": [
          {
            "count": 2,
            "x": 3,
            "y": 3,
          },
          {
            "count": 1,
            "x": 5,
            "y": 5,
          },
          {
            "count": 3,
            "x": 8,
            "y": 2,
          },
          {
            "count": 1,
            "x": 2,
            "y": 3,
          },
        ],
        "dimensions": {
          "height": 8,
          "width": 10,
        },
        "karel": {
          "beepers": 4,
          "facing": "south",
          "x": 2,
          "y": 1,
        },
        "walls": [
          {
            "from": {
              "x": 4,
              "y": 3,
            },
            "to": {
              "x": 4,
              "y": 4,
            },
          },
          {
            "from": {
              "x": 4,
              "y": 4,
            },
            "to": {
              "x": 4,
              "y": 5,
            },
          },
          {
            "from": {
              "x": 4,
              "y": 5,
            },
            "to": {
              "x": 5,
              "y": 5,
            },
          },
          {
            "from": {
              "x": 6,
              "y": 1,
            },
            "to": {
              "x": 6,
              "y": 2,
            },
          },
          {
            "from": {
              "x": 6,
              "y": 2,
            },
            "to": {
              "x": 7,
              "y": 2,
            },
          },
        ],
      }
    `);
  });

  it("reaches turnoff cleanly", () => {
    const { error, completed } = runDemo();

    // The demo is the project's front-door example, so it has to finish: the
    // ITERATE walks Karel from y=3 back down to the bottom row and stops there.
    // If a change to the program or the world makes it hit a wall instead,
    // this is the test that says so.
    expect(error).toBeNull();
    expect(completed).toBe(true);
  });

  it("executes a deterministic number of visible steps", () => {
    const { steps, trace } = runDemo();

    // The two counts differ by one on purpose: onStep fires for turnoff, but
    // the step() call that runs it returns false to say the program is over,
    // so the driving loop never counts it.
    expect(steps).toBe(12);
    expect(trace).toHaveLength(13);
    // Expanding a custom instruction is not a visible step, so `turnright` on
    // lines 18 and 28 shows up as the three turnleft lines of its body (4,5,6).
    expect(trace).toEqual([16, 17, 4, 5, 6, 19, 26, 4, 5, 6, 31, 31, 33]);
  });

  it("is reproducible: a second run from the same map lands identically", () => {
    const first = runDemo();
    const second = runDemo();

    expect(second.world.toJSON()).toEqual(first.world.toJSON());
    expect(second.trace).toEqual(first.trace);
  });
});

describe("the .klm file is the initial state, never the running state", () => {
  it("does not mutate the parsed map object while executing", () => {
    const parsed = JSON.parse(MAP_SOURCE) as KarelMap;
    const pristine = JSON.parse(MAP_SOURCE) as KarelMap;

    const validation = validateKarelMap(parsed);
    const world = new World(validation.map!);
    const interpreter = new Interpreter(world);
    interpreter.load(PROGRAM_SOURCE);
    while (interpreter.step()) {
      /* drive to the shutoff */
    }

    // Karel moved, dropped a beeper and emptied one bag slot in the World...
    expect(world.toJSON().karel).not.toEqual(parsed.karel);
    // ...while the object read from disk is byte-for-byte what it was.
    expect(parsed).toEqual(pristine);
    expect(JSON.stringify(parsed)).toBe(JSON.stringify(pristine));
  });

  it("hands the World a defensive copy, not the caller's own objects", () => {
    const parsed = JSON.parse(MAP_SOURCE) as KarelMap;
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
