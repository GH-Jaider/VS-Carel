/**
 * Black-box tests for the `karel` executable.
 *
 * These spawn dist/karel.mjs the way a grading script does and assert on the
 * three things such a script can actually observe: the exit code, stdout and
 * stderr. Nothing from src/ is imported on purpose — the contract under test is
 * the process interface, and a test that reached inside would keep passing
 * after a refactor that broke every marker's bash loop.
 *
 * The bundle is built by tests/globalSetup.ts before this file runs.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageRoot, "..", "..");

const CLI = join(packageRoot, "dist", "karel.mjs");
const DEMO_PROGRAM = join(repoRoot, "examples", "demo-program.kli");
const DEMO_WORLD = join(repoRoot, "examples", "simple-world.klm");

/** The exit codes from src/exit.ts, restated here so a change to them fails. */
const OK = 0;
const FAILED = 1;
const PARSE_ERROR = 2;
const LIMIT = 3;
const USAGE = 64;

interface Invocation {
  code: number;
  stdout: string;
  stderr: string;
}

function karel(...args: string[]): Invocation {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    cwd: repoRoot,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.signal) {
    throw new Error(`karel ${args.join(" ")} was killed by ${result.signal}`);
  }
  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

// --- fixtures ---------------------------------------------------------------

let dir: string;

/** Write a fixture into the scratch directory and return its absolute path. */
function fixture(name: string, contents: string): string {
  const path = join(dir, name);
  writeFileSync(path, contents, "utf8");
  return path;
}

function worldFixture(name: string, map: unknown): string {
  return fixture(name, JSON.stringify(map, null, 2));
}

/**
 * The world examples/demo-program.kli leaves behind: Karel two corners east of
 * where he started, facing south, one beeper of his five dropped at (2, 3).
 * Walls are omitted because --assert-world never compares them.
 */
function expectedFinalWorld() {
  return {
    dimensions: { width: 10, height: 8 },
    karel: { x: 2, y: 1, facing: "south", beepers: 4 },
    beepers: [
      { x: 3, y: 3, count: 2 },
      { x: 5, y: 5, count: 1 },
      { x: 8, y: 2, count: 3 },
      { x: 2, y: 3, count: 1 },
    ],
    walls: [] as unknown[],
  };
}

type FinalWorld = ReturnType<typeof expectedFinalWorld>;

/** An expected-world file that differs from the demo's real outcome in one way. */
function assertWorld(name: string, mutate: (map: FinalWorld) => void): string {
  const map = expectedFinalWorld();
  mutate(map);
  return worldFixture(name, map);
}

const HIT_WALL = `BEGINNING-OF-PROGRAM
	BEGINNING-OF-EXECUTION
		turnleft;
		move;
		turnoff
	END-OF-EXECUTION
END-OF-PROGRAM
`;

const PICK_NOTHING = `BEGINNING-OF-PROGRAM
	BEGINNING-OF-EXECUTION
		pickbeeper;
		turnoff
	END-OF-EXECUTION
END-OF-PROGRAM
`;

/** Turns full circle forever: front-is-clear never stops being true. */
const INFINITE = `BEGINNING-OF-PROGRAM
	BEGINNING-OF-EXECUTION
		WHILE front-is-clear DO
		BEGIN
			turnleft;
			turnleft;
			turnleft;
			turnleft
		END
		turnoff
	END-OF-EXECUTION
END-OF-PROGRAM
`;

const SYNTAX_ERROR = `BEGINNING-OF-PROGRAM
	BEGINNING-OF-EXECUTION
		move
`;

/** Parses, but earns the "never calls turnoff" warning. */
const WARNS_ONLY = `BEGINNING-OF-PROGRAM
	BEGINNING-OF-EXECUTION
		move
	END-OF-EXECUTION
END-OF-PROGRAM
`;

let hitWall: string;
let pickNothing: string;
let infinite: string;
let syntaxError: string;
let warnsOnly: string;
let exactWorld: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "karel-cli-test-"));
  hitWall = fixture("hit-wall.kli", HIT_WALL);
  pickNothing = fixture("pick-nothing.kli", PICK_NOTHING);
  infinite = fixture("infinite.kli", INFINITE);
  syntaxError = fixture("syntax-error.kli", SYNTAX_ERROR);
  warnsOnly = fixture("warns-only.kli", WARNS_ONLY);
  exactWorld = assertWorld("expected-exact.klm", () => {});
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

// --- the five exit codes ----------------------------------------------------

describe("exit codes", () => {
  it("exits 0 when a run reaches turnoff", () => {
    const { code, stdout } = karel("run", DEMO_PROGRAM, "--world", DEMO_WORLD);
    expect(code).toBe(OK);
    expect(stdout).toContain("finished after 13 steps");
  });

  it("exits 0 when check finds no errors", () => {
    const { code, stdout } = karel("check", DEMO_PROGRAM);
    expect(code).toBe(OK);
    expect(stdout).toContain("no errors");
  });

  it("exits 0 from check when the only diagnostics are warnings", () => {
    const { code, stdout, stderr } = karel("check", warnsOnly);
    expect(code).toBe(OK);
    expect(stdout).toContain("no errors");
    expect(stderr).toContain("warning:");
  });

  it("exits 1 when Karel walks into a wall", () => {
    const { code, stderr } = karel("run", hitWall, "--world", DEMO_WORLD);
    expect(code).toBe(FAILED);
    expect(stderr).toContain("the front is blocked");
    expect(stderr).toContain("on line 4");
  });

  it("exits 1 when Karel picks up a beeper that is not there", () => {
    const { code, stderr } = karel("run", pickNothing, "--world", DEMO_WORLD);
    expect(code).toBe(FAILED);
    expect(stderr).toContain("no beeper");
  });

  it("exits 1 when the final world does not match --assert-world", () => {
    const wrong = assertWorld("mismatch.klm", (m) => {
      m.karel.beepers = 0;
    });
    const { code } = karel("run", DEMO_PROGRAM, "-w", DEMO_WORLD, "-a", wrong);
    expect(code).toBe(FAILED);
  });

  it("exits 2 when the program does not parse, under run", () => {
    const { code, stderr } = karel("run", syntaxError, "--world", DEMO_WORLD);
    expect(code).toBe(PARSE_ERROR);
    expect(stderr).toContain("error:");
  });

  it("exits 2 when the program does not parse, under check", () => {
    const { code, stderr } = karel("check", syntaxError);
    expect(code).toBe(PARSE_ERROR);
    expect(stderr).toContain("Missing END-OF-EXECUTION");
  });

  it("exits 3 when the step budget runs out", () => {
    const { code, stderr } = karel("run", infinite, "--world", DEMO_WORLD, "--max-steps", "20");
    expect(code).toBe(LIMIT);
    expect(stderr).toContain("infinite loop");
  });

  it("distinguishes a loop (3) from a shutoff (1) on the same world", () => {
    const loop = karel("run", infinite, "-w", DEMO_WORLD, "-m", "20");
    const shutoff = karel("run", hitWall, "-w", DEMO_WORLD, "-m", "20");
    expect(loop.code).toBe(LIMIT);
    expect(shutoff.code).toBe(FAILED);
  });

  it("does not run the program at all when it fails to parse", () => {
    // steps must be absent from the failure: a parse failure reports
    // diagnostics only, never a half-executed world.
    const { code, stdout } = karel("run", syntaxError, "-w", DEMO_WORLD, "--json");
    expect(code).toBe(PARSE_ERROR);
    const payload = JSON.parse(stdout);
    expect(payload.status).toBe("parse-error");
    expect(payload.steps).toBeUndefined();
    expect(payload.world).toBeUndefined();
  });
});

// --- bad invocations --------------------------------------------------------

describe("usage errors exit 64", () => {
  it("rejects an unknown flag", () => {
    const { code, stdout, stderr } = karel("run", DEMO_PROGRAM, "--frobnicate");
    expect(code).toBe(USAGE);
    expect(stdout).toBe("");
    expect(stderr).toContain("--frobnicate");
  });

  it("rejects an unknown command", () => {
    const { code, stderr } = karel("frobnicate", DEMO_PROGRAM);
    expect(code).toBe(USAGE);
    expect(stderr).toContain("unknown command 'frobnicate'");
  });

  it("rejects a program file that does not exist", () => {
    const missing = join(dir, "does-not-exist.kli");
    const { code, stderr } = karel("run", missing, "--world", DEMO_WORLD);
    expect(code).toBe(USAGE);
    expect(stderr).toContain("no such file");
  });

  it("rejects a --world file that does not exist", () => {
    const missing = join(dir, "does-not-exist.klm");
    const { code, stderr } = karel("run", DEMO_PROGRAM, "--world", missing);
    expect(code).toBe(USAGE);
    expect(stderr).toContain("no such file");
  });

  it("rejects an --assert-world file that does not exist", () => {
    const missing = join(dir, "no-solution.klm");
    const { code, stderr } = karel("run", DEMO_PROGRAM, "-w", DEMO_WORLD, "-a", missing);
    expect(code).toBe(USAGE);
    expect(stderr).toContain("no such file");
  });

  it("rejects run without --world", () => {
    const { code, stderr } = karel("run", DEMO_PROGRAM);
    expect(code).toBe(USAGE);
    expect(stderr).toContain("run needs --world");
  });

  it("rejects a command with no program file", () => {
    const { code, stderr } = karel("check");
    expect(code).toBe(USAGE);
    expect(stderr).toContain("check needs a program file");
  });

  it("rejects an extra positional argument", () => {
    const { code, stderr } = karel("run", DEMO_PROGRAM, DEMO_PROGRAM, "-w", DEMO_WORLD);
    expect(code).toBe(USAGE);
    expect(stderr).toContain("unexpected argument");
  });

  it("rejects a world that is not valid JSON", () => {
    const broken = fixture("broken.klm", "{ dimensions: nope");
    const { code, stdout, stderr } = karel("run", DEMO_PROGRAM, "--world", broken);
    expect(code).toBe(USAGE);
    expect(stdout).toBe("");
    expect(stderr).toContain("is not valid JSON");
  });

  it("rejects a world that is valid JSON but not a valid world", () => {
    const invalid = worldFixture("invalid.klm", {
      dimensions: { width: 0, height: 8 },
      karel: { x: 1, y: 1, facing: "upwards", beepers: 5 },
      beepers: [],
      walls: [],
    });
    const { code, stderr } = karel("run", DEMO_PROGRAM, "--world", invalid);
    expect(code).toBe(USAGE);
    expect(stderr).toContain("is not a valid world");
    // Every validator complaint is listed, not just the first.
    expect(stderr).toContain("dimensions.width");
    expect(stderr).toContain("karel.facing");
  });

  it("rejects a world whose JSON is not an object", () => {
    const notAnObject = fixture("array.klm", "[1, 2, 3]");
    const { code, stderr } = karel("run", DEMO_PROGRAM, "--world", notAnObject);
    expect(code).toBe(USAGE);
    expect(stderr).toContain("is not a valid world");
  });

  it("rejects a malformed --assert-world file too", () => {
    const broken = fixture("broken-solution.klm", "nope");
    const { code, stderr } = karel("run", DEMO_PROGRAM, "-w", DEMO_WORLD, "-a", broken);
    expect(code).toBe(USAGE);
    expect(stderr).toContain("is not valid JSON");
  });

  it.each(["abc", "0", "-3", "", "Infinity", "NaN"])("rejects --max-steps=%j", (value) => {
    const { code, stdout, stderr } = karel(
      "run",
      DEMO_PROGRAM,
      "-w",
      DEMO_WORLD,
      `--max-steps=${value}`
    );
    expect(code).toBe(USAGE);
    expect(stdout).toBe("");
    expect(stderr).toContain("--max-steps needs a positive whole number");
  });
});

// --- --assert-world ---------------------------------------------------------

describe("--assert-world", () => {
  it("exits 0 when the final world matches exactly", () => {
    const { code, stdout, stderr } = karel("run", DEMO_PROGRAM, "-w", DEMO_WORLD, "-a", exactWorld);
    expect(code).toBe(OK);
    expect(stdout).toContain("finished after 13 steps");
    expect(stderr).toBe("");
  });

  const mismatches: Array<[string, (m: FinalWorld) => void, string]> = [
    [
      "Karel's position",
      (m) => {
        m.karel.x = 5;
        m.karel.y = 5;
      },
      "expected Karel at (5, 5), found (2, 1)",
    ],
    [
      "Karel's facing",
      (m) => {
        m.karel.facing = "north";
      },
      "expected Karel facing north, found south",
    ],
    [
      "the beepers in the bag",
      (m) => {
        m.karel.beepers = 9;
      },
      "expected 9 beepers in the bag, found 4",
    ],
    [
      "a pile with too few beepers",
      (m) => {
        m.beepers[0].count = 5;
      },
      "expected 5 beepers at (3, 3), found 2",
    ],
    [
      "a pile the program never made",
      (m) => {
        m.beepers.push({ x: 7, y: 7, count: 1 });
      },
      "expected 1 beeper at (7, 7), found 0",
    ],
    [
      "a pile the program should not have left",
      (m) => {
        m.beepers = m.beepers.filter((b) => !(b.x === 2 && b.y === 3));
      },
      "expected no beepers at (2, 3), found 1",
    ],
  ];

  it.each(mismatches)("exits 1 and names %s", (label, mutate, message) => {
    const expected = assertWorld(`mismatch-${label.replace(/\W+/g, "-")}.klm`, mutate);
    const { code, stdout, stderr } = karel("run", DEMO_PROGRAM, "-w", DEMO_WORLD, "-a", expected);
    expect(code).toBe(FAILED);
    expect(stderr).toContain(message);
    expect(stdout).toBe("");
  });

  it("names corners as (x, y) so a student can find them on the grid", () => {
    const expected = assertWorld("corner-format.klm", (m) => {
      m.beepers.push({ x: 7, y: 4, count: 2 });
    });
    const { stderr } = karel("run", DEMO_PROGRAM, "-w", DEMO_WORLD, "-a", expected);
    expect(stderr).toMatch(/\(7, 4\)/);
  });

  it("reports the shutoff rather than the mismatch when the program crashed", () => {
    // A wall is the cause; the wrong final world is only its consequence, and
    // reporting it would send the student looking in the wrong place.
    const { code, stderr } = karel("run", hitWall, "-w", DEMO_WORLD, "-a", exactWorld);
    expect(code).toBe(FAILED);
    expect(stderr).toContain("the front is blocked");
    expect(stderr).not.toContain("expected Karel");
  });

  it("says 'finished', not 'stopped', for a mismatch", () => {
    const expected = assertWorld("wording.klm", (m) => {
      m.karel.beepers = 0;
    });
    const { stderr } = karel("run", DEMO_PROGRAM, "-w", DEMO_WORLD, "-a", expected);
    expect(stderr).toContain("finished after 13 steps");
    expect(stderr).not.toContain("stopped after");
  });

  it("ignores walls and dimensions, which no instruction can change", () => {
    const expected = assertWorld("no-walls.klm", (m) => {
      m.dimensions = { width: 20, height: 20 };
      m.walls = [{ from: { x: 1, y: 1 }, to: { x: 2, y: 1 } }];
    });
    const { code } = karel("run", DEMO_PROGRAM, "-w", DEMO_WORLD, "-a", expected);
    expect(code).toBe(OK);
  });
});

// --- --json -----------------------------------------------------------------

describe("--json", () => {
  it("emits parseable JSON for a successful run", () => {
    const { code, stdout } = karel("run", DEMO_PROGRAM, "-w", DEMO_WORLD, "--json");
    expect(code).toBe(OK);
    const payload = JSON.parse(stdout);
    expect(payload.status).toBe("ok");
    expect(payload.steps).toBe(13);
    expect(payload.diagnostics).toEqual([]);
    expect(payload.world.karel).toEqual({ x: 2, y: 1, facing: "south", beepers: 4 });
    expect(payload.world.dimensions).toEqual({ width: 10, height: 8 });
    expect(payload.world.beepers).toContainEqual({ x: 2, y: 3, count: 1 });
  });

  it("emits parseable JSON for a runtime failure, with kind, line and message", () => {
    const { code, stdout } = karel("run", hitWall, "-w", DEMO_WORLD, "--json");
    expect(code).toBe(FAILED);
    const payload = JSON.parse(stdout);
    expect(payload.status).toBe("error");
    expect(payload.kind).toBe("blocked");
    expect(payload.line).toBe(4);
    expect(typeof payload.message).toBe("string");
    // The world as it stood when Karel stopped, so a marker can show it.
    expect(payload.world.karel).toMatchObject({ x: 1, y: 1, facing: "west" });
    expect(payload.steps).toBe(1);
  });

  it("emits parseable JSON for an assert-world mismatch", () => {
    const expected = assertWorld("json-mismatch.klm", (m) => {
      m.karel.facing = "east";
    });
    const { code, stdout } = karel("run", DEMO_PROGRAM, "-w", DEMO_WORLD, "-a", expected, "--json");
    expect(code).toBe(FAILED);
    const payload = JSON.parse(stdout);
    expect(payload.status).toBe("error");
    expect(payload.kind).toBe("assert-world");
    expect(payload.message).toContain("expected Karel facing east, found south");
  });

  it("emits parseable JSON for a blown budget", () => {
    const { code, stdout } = karel("run", infinite, "-w", DEMO_WORLD, "-m", "20", "--json");
    expect(code).toBe(LIMIT);
    const payload = JSON.parse(stdout);
    expect(payload.status).toBe("error");
    expect(payload.kind).toBe("limit");
    expect(payload.steps).toBe(20);
  });

  it("emits parseable JSON for a parse error", () => {
    const { code, stdout } = karel("check", syntaxError, "--json");
    expect(code).toBe(PARSE_ERROR);
    const payload = JSON.parse(stdout);
    expect(payload.status).toBe("parse-error");
    expect(Array.isArray(payload.diagnostics)).toBe(true);
    const [first] = payload.diagnostics;
    expect(first).toMatchObject({
      message: expect.any(String),
      line: expect.any(Number),
      column: expect.any(Number),
      severity: expect.any(String),
    });
    expect(payload.diagnostics.some((d: { severity: string }) => d.severity === "error")).toBe(
      true
    );
  });

  it("emits parseable JSON for a clean check", () => {
    const { code, stdout } = karel("check", DEMO_PROGRAM, "--json");
    expect(code).toBe(OK);
    expect(JSON.parse(stdout)).toEqual({ status: "ok", diagnostics: [] });
  });

  it("carries warnings in diagnostics instead of printing them as prose", () => {
    const { code, stdout } = karel("run", warnsOnly, "-w", DEMO_WORLD, "--json");
    expect(code).toBe(OK);
    const payload = JSON.parse(stdout);
    expect(payload.status).toBe("ok");
    expect(payload.diagnostics).toHaveLength(1);
    expect(payload.diagnostics[0].severity).toBe("warning");
    // The warning must not also be shouted into the JSON stream as text.
    expect(stdout.trimStart().startsWith("{")).toBe(true);
  });

  it.each([
    ["clean run", () => karel("run", DEMO_PROGRAM, "-w", DEMO_WORLD, "--json")],
    ["shutoff", () => karel("run", hitWall, "-w", DEMO_WORLD, "--json")],
    ["limit", () => karel("run", infinite, "-w", DEMO_WORLD, "-m", "20", "--json")],
    ["parse error", () => karel("run", syntaxError, "-w", DEMO_WORLD, "--json")],
    ["check", () => karel("check", DEMO_PROGRAM, "--json")],
    ["run with warnings", () => karel("run", warnsOnly, "-w", DEMO_WORLD, "--json")],
  ])("keeps stdout pure JSON for a %s", (_label, invoke) => {
    const { stdout } = invoke();
    // No prose before or after the object: the whole stream is the payload.
    expect(stdout.trimStart().startsWith("{")).toBe(true);
    expect(stdout.trimEnd().endsWith("}")).toBe(true);
    expect(() => JSON.parse(stdout)).not.toThrow();
  });
});

// --- stream separation ------------------------------------------------------

describe("stream separation", () => {
  it("leaves stdout empty on a shutoff so a redirect captures nothing", () => {
    const { stdout, stderr } = karel("run", hitWall, "-w", DEMO_WORLD);
    expect(stdout).toBe("");
    expect(stderr).not.toBe("");
  });

  it("leaves stdout empty on a parse error", () => {
    const { stdout, stderr } = karel("check", syntaxError);
    expect(stdout).toBe("");
    expect(stderr).toContain("2 errors");
  });

  it("leaves stdout empty on a usage error", () => {
    const { stdout } = karel("run", DEMO_PROGRAM);
    expect(stdout).toBe("");
  });

  it("keeps warnings off stdout even when the run succeeds", () => {
    const { code, stdout, stderr } = karel("run", warnsOnly, "-w", DEMO_WORLD);
    expect(code).toBe(OK);
    expect(stdout).toBe("warns-only.kli: finished after 1 step\n");
    expect(stderr).toContain("warning:");
  });

  it("writes only JSON to stdout when --json is redirected to a file", () => {
    const out = join(dir, "result.json");
    const result = spawnSync(
      "/bin/sh",
      [
        "-c",
        `"$1" "$2" run "$3" -w "$4" --json > "$5"`,
        "sh",
        process.execPath,
        CLI,
        hitWall,
        DEMO_WORLD,
        out,
      ],
      { encoding: "utf8", cwd: repoRoot }
    );
    expect(result.status).toBe(FAILED);
    const payload = JSON.parse(readFileSync(out, "utf8"));
    expect(payload.status).toBe("error");
    expect(payload.kind).toBe("blocked");
  });
});

// --- help, version, no arguments -------------------------------------------

describe("help and version", () => {
  it("--help exits 0 and writes usage to stdout", () => {
    const { code, stdout, stderr } = karel("--help");
    expect(code).toBe(OK);
    expect(stdout).toContain("Usage:");
    expect(stdout).toContain("karel run <program.kli> --world <world.klm>");
    expect(stderr).toBe("");
  });

  it("-h is the same as --help", () => {
    expect(karel("-h").stdout).toBe(karel("--help").stdout);
  });

  it("documents every exit code it can return", () => {
    const { stdout } = karel("--help");
    for (const code of ["0", "1", "2", "3", "64"]) {
      expect(stdout).toMatch(new RegExp(`^\\s*${code}\\s`, "m"));
    }
  });

  it("--version exits 0 and writes the version to stdout", () => {
    const { code, stdout, stderr } = karel("--version");
    expect(code).toBe(OK);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    expect(stderr).toBe("");
  });

  it("-v reports the version in package.json", () => {
    // main.ts keeps VERSION by hand; this is the check that catches the drift.
    const pkg = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
    expect(karel("-v").stdout.trim()).toBe(pkg.version);
  });

  it("exits 64 with usage on stderr when given no arguments", () => {
    const { code, stdout, stderr } = karel();
    expect(code).toBe(USAGE);
    expect(stdout).toBe("");
    expect(stderr).toContain("Usage:");
  });
});

// --- the thing the CLI exists for ------------------------------------------

describe("grading a batch of submissions", () => {
  it("separates a passing submission from a failing one by exit code alone", () => {
    // The loop from `karel --help`, run for real over two submissions.
    const submissions = mkdtempSync(join(dir, "submissions-"));
    writeFileSync(join(submissions, "a-good.kli"), readFileSync(DEMO_PROGRAM, "utf8"));
    writeFileSync(join(submissions, "b-bad.kli"), HIT_WALL);

    // Note the shell subtlety this mirrors: $? has to be read before anything
    // else runs, so the basename comes from ${f##*/} rather than a subshell.
    const script = `
      for f in "$SUBMISSIONS"/*.kli; do
        "$NODE" "$CLI" run "$f" -w "$WORLD" -a "$SOLUTION" >/dev/null 2>&1 \\
          && echo "PASS \${f##*/}" || echo "FAIL \${f##*/} ($?)"
      done
    `;
    const result = spawnSync("/bin/sh", ["-c", script], {
      encoding: "utf8",
      env: {
        ...process.env,
        NODE: process.execPath,
        CLI,
        SUBMISSIONS: submissions,
        WORLD: DEMO_WORLD,
        SOLUTION: exactWorld,
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trim().split("\n")).toEqual(["PASS a-good.kli", "FAIL b-bad.kli (1)"]);
  });

  it("gives the marker a different code for each kind of bad submission", () => {
    const world = ["-w", DEMO_WORLD, "-a", exactWorld];
    expect(karel("run", DEMO_PROGRAM, ...world).code).toBe(OK);
    expect(karel("run", hitWall, ...world).code).toBe(FAILED);
    expect(karel("run", syntaxError, ...world).code).toBe(PARSE_ERROR);
    expect(karel("run", infinite, ...world, "-m", "50").code).toBe(LIMIT);
    expect(karel("run", join(dir, "never-submitted.kli"), ...world).code).toBe(USAGE);
  });

  it("is deterministic: the same submission grades the same twice", () => {
    const first = karel("run", DEMO_PROGRAM, "-w", DEMO_WORLD, "--json");
    const second = karel("run", DEMO_PROGRAM, "-w", DEMO_WORLD, "--json");
    expect(second.code).toBe(first.code);
    expect(second.stdout).toBe(first.stdout);
  });

  it("does not let one submission's world leak into the next", () => {
    // Each run must start from the file on disk, not from a mutated copy.
    const dropper = fixture(
      "drop.kli",
      `BEGINNING-OF-PROGRAM
	BEGINNING-OF-EXECUTION
		putbeeper;
		turnoff
	END-OF-EXECUTION
END-OF-PROGRAM
`
    );
    const first = JSON.parse(karel("run", dropper, "-w", DEMO_WORLD, "--json").stdout);
    const second = JSON.parse(karel("run", dropper, "-w", DEMO_WORLD, "--json").stdout);
    expect(second.world).toEqual(first.world);
    expect(second.world.karel.beepers).toBe(4);
    expect(readFileSync(DEMO_WORLD, "utf8")).toContain('"beepers": 5');
  });
});
