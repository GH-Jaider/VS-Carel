/**
 * The levels folder, and the link that adds one to it.
 *
 * The load-bearing test here is the last one in the first block: every level's
 * reference solution is executed against its own world and the result is put
 * through `checkLevel`, which is the core's `sameExercise` + `compareWorlds`
 * — the pair the CLI grades submissions with. That is what stops an
 * impossible level from being published, and it is the same reason the
 * curriculum runs its chapters: a level nobody can solve is worse than no
 * level, because the student assumes the fault is theirs.
 *
 * Everything else guards the other end of the pipe. `contributionUrl` builds
 * a link out of a level and a link has a length limit, so the tests check
 * both sides of that limit and — more usefully — that the JSON survives the
 * round trip through percent-encoding and comes back as the same level.
 */

import { describe, expect, it } from "vitest";
import { Interpreter, World, validateKarelMap, type KarelMap } from "@karel/core";
import {
  DEFAULT_ORDER,
  DIFFICULTIES,
  LEVELS,
  checkLevel,
  levelById,
  levelGroups,
  loadLevels,
  sortLevels,
  validateLevel,
  type Difficulty,
  type Level,
} from "../src/levels";
import {
  ISSUE_LABEL,
  MAX_URL_LENGTH,
  REPO,
  buildLevel,
  contributionUrl,
  formatLevelJson,
  slugify,
} from "../src/contribute";

/** The same folder the app loads, read again so file names can be checked. */
const FILES = import.meta.glob<{ default: unknown }>("../levels/*.json", { eager: true });

/**
 * Run `source` against `map` the way the CLI does — every step, no delay —
 * and report what happened. `while (step())` rather than `run()` because
 * `run()` sleeps between instructions and a test has nothing to watch.
 */
function execute(
  source: string,
  map: KarelMap
): { world: KarelMap; steps: number; completed: boolean; failure: string | null } {
  const world = new World(map);
  const interpreter = new Interpreter(world, { maxSteps: 20_000 });
  const diagnostics = interpreter.load(source);
  if (diagnostics.some((d) => d.severity === "error")) {
    return { world: world.toJSON(), steps: 0, completed: false, failure: "did not parse" };
  }

  let steps = 0;
  let completed = false;
  let failure: string | null = null;
  interpreter.onStep = () => {
    steps++;
  };
  interpreter.onComplete = () => {
    completed = true;
  };
  interpreter.onError = (error) => {
    failure ??= `${error.kind} on line ${error.line}: ${error.message}`;
  };
  try {
    while (interpreter.step()) {
      // Driving only.
    }
  } catch (error) {
    failure ??= error instanceof Error ? error.message : String(error);
  }
  return { world: world.toJSON(), steps, completed, failure };
}

describe("the levels folder", () => {
  it("loads every file", () => {
    expect(LEVELS.length).toBeGreaterThanOrEqual(12);
    expect(Object.keys(FILES)).toHaveLength(LEVELS.length);
  });

  it("gives every level a unique id that matches its file name", () => {
    const ids = LEVELS.map((level) => level.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const path of Object.keys(FILES)) {
      const file = path.slice(path.lastIndexOf("/") + 1);
      expect(levelById(file.replace(/\.json$/, ""))).toBeDefined();
    }
  });

  it("fills every difficulty band, and orders them the way they are shown", () => {
    const groups = levelGroups();
    expect(groups.map((g) => g.difficulty)).toEqual([...DIFFICULTIES]);
    for (const group of groups) {
      expect(group.levels.length).toBeGreaterThan(0);
    }
    // The flattened groups are the collection, in the collection's own order.
    expect(groups.flatMap((g) => g.levels.map((l) => l.id))).toEqual(LEVELS.map((l) => l.id));
  });

  it.each(LEVELS.map((level) => [level.id, level] as const))("%s validates", (_id, level) => {
    for (const map of [level.world, level.goal]) {
      const result = validateKarelMap(JSON.parse(JSON.stringify(map)));
      expect(result.errors).toEqual([]);
      expect(result.ok).toBe(true);
    }
  });

  it.each(LEVELS.map((level) => [level.id, level] as const))(
    "%s does not start on its own goal",
    (_id, level) => {
      // A level whose starting world already satisfies the goal is solved by
      // the empty program, which is not a level.
      expect(checkLevel(level, level.world)).not.toBeNull();
    }
  );

  it.each(LEVELS.map((level) => [level.id, level] as const))(
    "%s is solved by its reference solution",
    (_id, level) => {
      // No diagnostics at all, not merely no errors: the parser reports a
      // missing turnoff as a warning, and a reference solution that never
      // shuts Karel off is not the example anyone should be shown.
      expect(new Interpreter(new World(level.world)).load(level.solution)).toEqual([]);

      const result = execute(level.solution, level.world);
      expect(result.failure).toBeNull();
      expect(result.completed).toBe(true);
      expect(checkLevel(level, result.world)).toBeNull();
    }
  );

  it("ships every bundled level in both languages", () => {
    // The schema only requires English, because a level written by someone
    // who speaks one language is still worth having. The project's own
    // collection is held to a higher bar than the schema is.
    for (const level of LEVELS) {
      for (const text of [level.title, level.brief]) {
        expect(text.es, `${level.id}: missing Spanish`).toBeTruthy();
        expect(text.es).not.toBe(text.en);
      }
    }
  });
});

// ── The schema ────────────────────────────────────────────────────────────

/** A minimal level that passes, for a test to spoil one field at a time. */
function sample(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "sample",
    difficulty: "starter",
    author: "tester",
    title: { en: "sample" },
    brief: { en: "Walk east." },
    world: {
      dimensions: { width: 3, height: 1 },
      karel: { x: 1, y: 1, facing: "east", beepers: 0 },
      beepers: [],
      walls: [],
    },
    goal: {
      dimensions: { width: 3, height: 1 },
      karel: { x: 3, y: 1, facing: "east", beepers: 0 },
      beepers: [],
      walls: [],
    },
    solution:
      "BEGINNING-OF-PROGRAM\n  BEGINNING-OF-EXECUTION\n    move;\n    move;\n    turnoff\n" +
      "  END-OF-EXECUTION\nEND-OF-PROGRAM\n",
    ...overrides,
  };
}

describe("validateLevel", () => {
  it("accepts a level and fills in the defaults", () => {
    const result = validateLevel(sample());
    expect(result.errors).toEqual([]);
    expect(result.level?.order).toBe(DEFAULT_ORDER);
    expect(result.level?.ignoreFacing).toBeUndefined();
  });

  it.each([
    ["not an object", "nope"],
    ["a missing id", sample({ id: undefined })],
    ["an id that is not kebab-case", sample({ id: "Sample Level" })],
    ["an unknown difficulty", sample({ difficulty: "impossible" })],
    ["no author", sample({ author: "  " })],
    ["a title with no English", sample({ title: { es: "muestra" } })],
    ["an empty brief", sample({ brief: { en: "" } })],
    ["no solution", sample({ solution: undefined })],
    ["a world that is not a map", sample({ world: { dimensions: { width: 0, height: 0 } } })],
    [
      "a beeper outside the world",
      sample({ goal: { ...(sample().goal as object), beepers: [{ x: 9, y: 9, count: 1 }] } }),
    ],
  ])("rejects %s", (_what, data) => {
    const result = validateLevel(data);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.level).toBeUndefined();
  });

  it("rejects a goal that is a different exercise", () => {
    // A wall is something no instruction can build or remove, so a goal that
    // has one the world does not is not a harder level: it is unreachable.
    const goal = sample().goal as Record<string, unknown>;
    const result = validateLevel(
      sample({ goal: { ...goal, walls: [{ from: { x: 1, y: 1 }, to: { x: 2, y: 1 } }] } })
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("not the same exercise");
  });

  it("rejects a goal of a different size", () => {
    const goal = sample().goal as Record<string, unknown>;
    const result = validateLevel(
      sample({ goal: { ...goal, dimensions: { width: 4, height: 1 } } })
    );
    expect(result.ok).toBe(false);
  });
});

describe("loadLevels", () => {
  const file = (data: unknown) => ({ default: data });

  it("refuses a file whose name does not match its id", () => {
    expect(() => loadLevels({ "../levels/other.json": file(sample()) })).toThrow(/rename/);
  });

  it("refuses two files claiming the same id", () => {
    expect(() =>
      loadLevels({
        "../levels/sample.json": file(sample()),
        "../levels/copy.json": file(sample()),
      })
    ).toThrow();
  });

  it("names the file and the reason when one is invalid", () => {
    expect(() =>
      loadLevels({ "../levels/broken.json": file(sample({ difficulty: "nope" })) })
    ).toThrow(/levels\/broken\.json[\s\S]*difficulty/);
  });

  it("sorts by band, then by order, then by id", () => {
    const at = (id: string, difficulty: Difficulty, order: number): Level => ({
      ...(validateLevel(sample({ id, difficulty, order })).level as Level),
    });
    const sorted = sortLevels([
      at("zebra", "hard", 1),
      at("beta", "starter", 5),
      at("alpha", "starter", 5),
      at("gamma", "tricky", 1),
    ]);
    expect(sorted.map((l) => l.id)).toEqual(["alpha", "beta", "gamma", "zebra"]);
  });
});

// ── The contribution link ─────────────────────────────────────────────────

/** Pull the fenced JSON back out of an issue body. */
function fencedJson(body: string): string {
  const match = /```json\n([\s\S]*?)\n```/.exec(body);
  expect(match, "the body has no ```json block").not.toBeNull();
  return match![1];
}

/** A level with `walls` walls, to push the URL over the limit on purpose. */
function heavyLevel(size: number): Level {
  const walls = [];
  for (let x = 1; x <= size; x++) {
    for (let y = 1; y <= size; y++) {
      if (x < size) {
        walls.push({ from: { x, y }, to: { x: x + 1, y } });
      }
      if (y < size) {
        walls.push({ from: { x, y }, to: { x, y: y + 1 } });
      }
    }
  }
  const world: KarelMap = {
    dimensions: { width: size, height: size },
    karel: { x: 1, y: 1, facing: "north", beepers: 0 },
    beepers: [],
    walls,
  };
  return {
    id: "heavy",
    difficulty: "hard",
    order: DEFAULT_ORDER,
    author: "tester",
    title: { en: "heavy" },
    brief: { en: "Every wall in a hundred by a hundred world." },
    world,
    goal: { ...world, karel: { ...world.karel, facing: "east" } },
    solution:
      "BEGINNING-OF-PROGRAM\n  BEGINNING-OF-EXECUTION\n    turnleft;\n turnleft;\n" +
      " turnleft;\n turnoff\n  END-OF-EXECUTION\nEND-OF-PROGRAM\n",
  };
}

describe("contributionUrl", () => {
  const level = LEVELS.find((l) => l.id === "corridor")!;

  it("builds a GitHub issue URL with the level in it", () => {
    const contribution = contributionUrl(level);
    expect(contribution.tooLong).toBe(false);

    const url = new URL(contribution.url);
    expect(url.origin).toBe("https://github.com");
    expect(url.pathname).toBe(`/${REPO}/issues/new`);
    expect(url.searchParams.get("labels")).toBe(ISSUE_LABEL);
    expect(url.searchParams.get("title")).toContain(level.id);
    expect(url.searchParams.get("body")).toBe(contribution.body);
  });

  it("carries a level that survives the round trip", () => {
    // Percent-encoding, a query string and a fenced block sit between the
    // level here and the file a maintainer saves. What comes out the far end
    // has to be the level that went in.
    const contribution = contributionUrl(level);
    const body = new URL(contribution.url).searchParams.get("body")!;
    const returned = validateLevel(JSON.parse(fencedJson(body)));
    expect(returned.errors).toEqual([]);
    expect(returned.level).toEqual(level);
  });

  it("names the file the maintainer should save", () => {
    expect(contributionUrl(level).body).toContain(`apps/web/levels/${level.id}.json`);
  });

  it("fits every bundled level except the ones that are honestly too big", () => {
    const oversized = LEVELS.filter((l) => contributionUrl(l).tooLong).map((l) => l.id);
    // Not zero — a 6x6 maze really does not fit in a query string, and the
    // point of the fallback is that this case is normal rather than exotic.
    expect(oversized.length).toBeLessThan(LEVELS.length / 2);
    for (const contribution of LEVELS.map(contributionUrl)) {
      expect(contribution.url.length).toBeLessThanOrEqual(MAX_URL_LENGTH);
    }
  });

  it("degrades to a paste-it-here issue when the level cannot fit", () => {
    const contribution = contributionUrl(heavyLevel(100));
    expect(contribution.tooLong).toBe(true);
    expect(contribution.length).toBeGreaterThan(MAX_URL_LENGTH);

    // The link still works, still opens the right issue, and still tells the
    // contributor what to do with the JSON now on their clipboard.
    expect(contribution.url.length).toBeLessThan(MAX_URL_LENGTH);
    expect(new URL(contribution.url).searchParams.get("labels")).toBe(ISSUE_LABEL);
    expect(fencedJson(contribution.body)).toContain("paste");
    // The whole file is still available, whatever the URL could carry.
    expect(JSON.parse(contribution.json).world.walls.length).toBe(19_800);
  });

  it("switches over exactly at the limit", () => {
    // Grow the brief a character at a time across the threshold: the test
    // that matters is not that a megabyte fails, it is that the boundary is
    // where the constant says it is.
    let pad = 1;
    let last = contributionUrl({ ...level, brief: { en: "x".repeat(pad) } });
    while (!last.tooLong && pad < 20_000) {
      pad *= 2;
      last = contributionUrl({ ...level, brief: { en: "x".repeat(pad) } });
    }
    expect(last.tooLong).toBe(true);

    let low = 1;
    let high = pad;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (contributionUrl({ ...level, brief: { en: "x".repeat(middle) } }).tooLong) {
        high = middle;
      } else {
        low = middle + 1;
      }
    }
    const under = contributionUrl({ ...level, brief: { en: "x".repeat(low - 1) } });
    const over = contributionUrl({ ...level, brief: { en: "x".repeat(low) } });
    expect(under.tooLong).toBe(false);
    expect(under.length).toBeLessThanOrEqual(MAX_URL_LENGTH);
    expect(over.tooLong).toBe(true);
    expect(over.length).toBeGreaterThan(MAX_URL_LENGTH);
  });
});

describe("formatLevelJson", () => {
  it.each(LEVELS.map((level) => [level.id, level] as const))(
    "%s round-trips through its file text",
    (_id, level) => {
      const text = formatLevelJson(level);
      expect(text.endsWith("\n")).toBe(true);
      const result = validateLevel(JSON.parse(text));
      expect(result.errors).toEqual([]);
      expect(result.level).toEqual(level);
    }
  );

  it("keeps a wall on one line and a long brief on its own", () => {
    // Not cosmetic: `JSON.stringify(x, null, 2)` spreads every coordinate over
    // three lines, and a newline costs three characters once encoded. The
    // shape below is what keeps ordinary levels inside the URL limit.
    const text = formatLevelJson(LEVELS.find((l) => l.id === "detour")!);
    expect(text).toContain(`{ "from": { "x": 4, "y": 1 }, "to": { "x": 5, "y": 1 } }`);
    expect(text).toContain(`"dimensions": { "width": 7, "height": 3 },`);
  });
});

describe("buildLevel", () => {
  const draft = {
    difficulty: "starter" as Difficulty,
    author: "  tester  ",
    title: "The Long Way Round!",
    brief: "Go all the way round.",
    world: sample().world as KarelMap,
    goal: sample().goal as KarelMap,
    solution: sample().solution as string,
  };

  it("derives an id from the title and trims the author", () => {
    const result = buildLevel({ ...draft, textLocale: "en" });
    expect(result.errors).toEqual([]);
    expect(result.level?.id).toBe("the-long-way-round");
    expect(result.level?.author).toBe("tester");
    expect(result.level?.title).toEqual({ en: "The Long Way Round!" });
  });

  it("keeps an explicit id", () => {
    expect(buildLevel({ ...draft, id: "my-level", textLocale: "en" }).level?.id).toBe("my-level");
  });

  it("copies text typed in another language into English as well", () => {
    // English is the schema's fallback, so a level with only Spanish text
    // would not load at all. The copy is deliberate and the issue body says
    // so; the alternative is a level nobody can read or a level nobody can use.
    const result = buildLevel({
      ...draft,
      title: "El camino largo",
      brief: "Da toda la vuelta.",
      textLocale: "es",
    });
    expect(result.level?.title).toEqual({ en: "El camino largo", es: "El camino largo" });
    expect(contributionUrl(result.level!).body).toContain("needs translating");
  });

  it("reports why a draft cannot become a level", () => {
    const result = buildLevel({ ...draft, textLocale: "en", author: "", title: "" });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/author/);
  });
});

describe("slugify", () => {
  it.each([
    ["The Long Way Round!", "the-long-way-round"],
    ["  spaced   out  ", "spaced-out"],
    ["El laberinto de Kárel", "el-laberinto-de-karel"],
    ["¿¡!?", ""],
  ])("%s → %s", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });
});
