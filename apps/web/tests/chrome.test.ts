/**
 * The chrome held against the page it is wiring.
 *
 * There is a bug this project has already paid for once: main.ts was written
 * against class names that were never in the stylesheet, so the diagnostics it
 * built were real, correct, and invisible for days. Nothing in the type system
 * can catch that — a class name is a string on one side and a selector on the
 * other, and no compiler reads both.
 *
 * So this file reads both. Every class main.ts puts on an element, and every
 * class the markup ships, has to be a class main.css defines; every element
 * main.ts demands with `query()` has to be in index.html. It is a crude check
 * by design: string extraction with regular expressions, no parser, no build.
 * A class this misses is a check that did not happen, which is the harmless
 * failure. A class it finds that the stylesheet has never heard of is the one
 * that cost the days.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), "utf8");

const MAIN = read("src/main.ts");
const HTML = read("index.html");
const CSS = read("src/styles/main.css");

/** Every `.name` that appears anywhere in a selector in the stylesheet. */
const STYLED = new Set([...CSS.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((match) => match[1]));

/**
 * Class names the stylesheet is not expected to own.
 *
 * CodeMirror brings its own, and the editor re-dresses them under `.cm-*`
 * rules that this extraction cannot see as class *uses*; they are checked by
 * the editor's own tests instead.
 */
function ours(name: string): boolean {
  return !name.startsWith("cm-");
}

function classesIn(source: string): Set<string> {
  const found = new Set<string>();
  const add = (value: string): void => {
    for (const name of value.split(/\s+/)) {
      if (name && !name.includes("$") && ours(name)) {
        found.add(name);
      }
    }
  };

  // `className = "a b"`, and the template-literal form with the interpolations
  // taken out: `problem ${severity}` still promises a `.problem` rule.
  for (const match of source.matchAll(/className\s*=\s*"([^"]*)"/g)) {
    add(match[1]);
  }
  for (const match of source.matchAll(/className\s*=\s*`([^`]*)`/g)) {
    add(match[1].replace(/\$\{[^}]*\}/g, " "));
  }
  for (const match of source.matchAll(/classList\.(?:add|toggle)\("([^"]*)"/g)) {
    add(match[1]);
  }
  // Markup, whether it ships in index.html or is written as a string by the
  // chrome: `class="..."` means the same thing in both.
  for (const match of source.matchAll(/class="([^"]*)"/g)) {
    add(match[1]);
  }
  return found;
}

describe("every class the chrome writes is a class the stylesheet defines", () => {
  it("holds for src/main.ts", () => {
    const used = [...classesIn(MAIN)].sort();
    // A guard on the extraction itself: a regex that quietly stopped matching
    // would turn this whole file into a test that always passes.
    expect(used.length).toBeGreaterThan(30);
    expect(used.filter((name) => !STYLED.has(name))).toEqual([]);
  });

  it("holds for index.html", () => {
    const used = [...classesIn(HTML)].sort();
    expect(used.length).toBeGreaterThan(30);
    expect(used.filter((name) => !STYLED.has(name))).toEqual([]);
  });
});

describe("every element the chrome demands is in the page", () => {
  /** `query("#run")` and `query<HTMLButtonElement>(".workshop")` alike. */
  const demanded = [...MAIN.matchAll(/\bquery(?:<[^>]*>)?\("([^"]+)"\)/g)].map((m) => m[1]);

  it("finds the selectors main.ts refuses to start without", () => {
    // `query()` throws on a miss, so every one of these is a page that would
    // not boot at all.
    expect(demanded.length).toBeGreaterThan(30);

    const missing = demanded.filter((selector) => {
      if (selector.startsWith("#")) {
        return !new RegExp(`id="${selector.slice(1)}"`).test(HTML);
      }
      if (selector.startsWith(".")) {
        const name = selector.slice(1);
        return ![...classesIn(HTML)].includes(name);
      }
      // A tag name, or something this check does not understand: leave it.
      return false;
    });
    expect(missing).toEqual([]);
  });
});

/**
 * The arrangement itself, held against the page.
 *
 * These are not style checks -- nothing here has an opinion about a colour or
 * a pixel. They pin the three decisions the layout rests on, each of which was
 * arrived at by measuring the page and each of which is quietly undone by an
 * innocent-looking edit: the world's frame is cut in the chrome and must never
 * be measured back, the map's text belongs to the code column, and the map's
 * tools are a line of the console rather than a panel under the world.
 */
describe("the world is the biggest thing on the bench", () => {
  it("cuts the world's frame in the chrome, and measures the slot rather than the frame", () => {
    // The renderer fits the canvas to the box it is given, so a box sized from
    // its own contents is circular: the two would chase each other down to
    // nothing. The slot is the row the stage gives the world, and nothing
    // inside it can change its size.
    expect(MAIN).toContain("private fitViewport");
    expect(MAIN).toContain("observe(this.dom.worldSlot)");
    expect(MAIN).not.toContain('observe(query("#viewport"))');
    expect(HTML).toContain('id="world-slot"');
  });

  it("keeps the map's text in the code column", () => {
    // A .klm is code, and the code column is where code lives. Under the world
    // it was a band 306 pixels tall that pushed the world off the screen.
    const workshop = HTML.indexOf('class="workshop"');
    const stage = HTML.indexOf('class="stage"');
    const host = HTML.indexOf('id="map-source-host"');
    expect(workshop).toBeGreaterThan(-1);
    expect(host).toBeGreaterThan(workshop);
    expect(host).toBeLessThan(stage);
  });

  it("gives the code column two tabs, and cuts the map's only where it means something", () => {
    for (const id of ["doc-tabs", "tab-program", "tab-map"]) {
      expect(HTML, id).toContain(`id="${id}"`);
    }
    expect(MAIN).toContain("this.dom.mapTab.hidden = !this.canEditWorld()");
  });

  it("makes the map tools a line of the console rather than a panel of their own", () => {
    const console_ = HTML.indexOf('class="console"');
    const palette = HTML.indexOf('id="palette"');
    expect(console_).toBeGreaterThan(-1);
    expect(palette).toBeGreaterThan(console_);
    expect(HTML).toContain('class="console-row map-row"');
    // The file's own operation went with the file.
    expect(HTML.indexOf('id="format-map"')).toBeLessThan(HTML.indexOf('class="stage"'));
  });
});

describe("the three modes are wired end to end", () => {
  it("gives the masthead a mode switch rather than a world picker", () => {
    // The nav that used to carry one .channel per bundled world now carries
    // one per mode, and the chrome fills it by id.
    expect(HTML).toContain('id="modes"');
    expect(HTML).not.toContain('id="worlds"');
    expect(MAIN).toContain('modes: query("#modes")');
  });

  it("ships the two surfaces the modes need", () => {
    for (const id of ["guide", "guide-body", "gallery", "gallery-body", "bench"]) {
      expect(HTML, id).toContain(`id="${id}"`);
    }
  });

  it("lays the bench out from one attribute, and styles all three values", () => {
    // main.ts writes `data-layout`; main.css is the only thing that reads it.
    expect(MAIN).toContain('this.dom.bench.dataset["layout"]');
    for (const layout of ["guide", "gallery"]) {
      expect(CSS, layout).toContain(`.bench[data-layout="${layout}"]`);
    }
  });

  it("grades a finished run with the core's own comparison, never its own", () => {
    // The whole promise of learn and levels: passing here is passing at the
    // command line. A second implementation of "is this right" in the chrome
    // would break that quietly.
    expect(MAIN).toContain("checkChapter(");
    expect(MAIN).toContain("checkLevel(");
    // Asked of the imports rather than of the whole text, so the paragraph
    // explaining why the chrome delegates does not fail the check that it
    // delegates.
    const imports = [...MAIN.matchAll(/^import[\s\S]*?from "[^"]+";$/gm)]
      .map((match) => match[0])
      .join("\n");
    expect(imports.length).toBeGreaterThan(200);
    expect(imports).not.toContain("compareWorlds");
    expect(imports).not.toContain("sameExercise");
  });
});
