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
 * The three panes in one box.
 *
 * A `.klm` is code, so it lives in the column where code lives; and in learn
 * the chapter lives there too, because a lesson needs a column and there is
 * only one to give it. So: a tab per pane cut into the top border, three hosts
 * stacked in one cell, and one problems panel per *document* — the lesson is
 * not one. Each of the checks below pins a decision that an innocent-looking
 * edit undoes silently — the hiding mechanism above all, which fails as a
 * missing gutter rather than as an error.
 */
describe("the code column holds two documents and a lesson", () => {
  it("cuts a tab per pane into the top of the box", () => {
    for (const id of ["doc-tabs", "tab-program", "tab-map", "tab-lesson"]) {
      expect(HTML, id).toContain(`id="${id}"`);
    }
    // Both tabs are in the same strip, and the strip is inside the code box
    // rather than floating above the column.
    expect(HTML.indexOf('id="doc-tabs"')).toBeGreaterThan(HTML.indexOf('class="editor"'));
    expect(HTML.indexOf('id="tab-map"')).toBeLessThan(HTML.indexOf('id="editor-host"'));
    // The lesson is the first tab in the strip, and it is in the strip.
    expect(HTML.indexOf('id="tab-lesson"')).toBeGreaterThan(HTML.indexOf('id="doc-tabs"'));
    expect(HTML.indexOf('id="tab-lesson"')).toBeLessThan(HTML.indexOf('id="tab-program"'));
  });

  it("keeps the lesson pane in the same cell as the two editors", () => {
    // Same box, same border, same tabs: the pane is a sibling of the editor
    // hosts inside `.editor`, not a fourth column that appears in learn.
    const editor = HTML.indexOf('class="editor"');
    const problems = HTML.indexOf('id="program-problems"');
    const host = HTML.indexOf('id="lesson-host"');
    expect(host).toBeGreaterThan(editor);
    expect(host).toBeLessThan(problems);
    expect(HTML).toContain('id="lesson-body"');
    // It is set to the same measure as the box of its own, so a chapter reads
    // identically whichever surface it is drawn on.
    const pane = HTML.slice(host, problems);
    expect(pane).toContain('class="guide-scroll"');
    const rule = CSS.slice(CSS.indexOf(".lesson-host {"));
    expect(rule.slice(0, rule.indexOf("}"))).toContain("grid-area: 1 / 1");
  });

  it("keeps the map's text in the code column, not under the world", () => {
    const workshop = HTML.indexOf('class="workshop"');
    const stage = HTML.indexOf('class="stage"');
    const host = HTML.indexOf('id="map-source-host"');
    expect(workshop).toBeGreaterThan(-1);
    expect(host).toBeGreaterThan(workshop);
    expect(host).toBeLessThan(stage);
    // The file's own operation went with the file.
    expect(HTML.indexOf('id="format-map"')).toBeLessThan(stage);
  });

  it("hides the editor that is not in front with visibility, never with display", () => {
    // The bug this pattern always produces: CodeMirror in a box that is not
    // displayed measures itself as zero and comes back with no gutter and no
    // scroll position. `is-off` is the class that has to keep the box laid out.
    // The lesson in front puts the program editor away by the same route.
    expect(MAIN).toContain('this.dom.editorHost.classList.toggle("is-off", map || lesson)');
    expect(MAIN).toContain('this.dom.mapHost.classList.toggle("is-off", !map)');
    const rule = CSS.slice(CSS.indexOf(".editor-host.is-off"));
    expect(rule.slice(0, rule.indexOf("}"))).toContain("visibility: hidden");
    expect(rule.slice(0, rule.indexOf("}"))).not.toContain("display: none");
  });

  it("hides the lesson pane the other way, so it cannot hold the box open", () => {
    // Nothing in the lesson measures itself, and where the box grows with its
    // content — stacked, under 1120px — a merely invisible pane would hold it
    // open at the height of the whole chapter with the program in front.
    expect(MAIN).toContain("this.dom.lessonHost.hidden = !lesson");
    const rule = CSS.slice(CSS.indexOf(".lesson-host[hidden]"));
    expect(rule.slice(0, rule.indexOf("}"))).toContain("display: none");
    // And the reader's place in it is kept by hand, since display: none loses
    // the scroll position the browser would otherwise have remembered.
    expect(MAIN).toContain("this.dom.lessonBody.scrollTop = this.lessonScroll");
  });

  it("cuts the map's tab only where the world is the visitor's to change", () => {
    // In learn and in an opened level a world rearranged by hand is a check
    // that certifies nothing, so there is no document to open and no tab.
    expect(MAIN).toContain("this.dom.mapTab.hidden = !editable");
    expect(MAIN).toContain("const editable = this.canEditWorld()");
    // And with one tab there is no selection worth marking: the strip goes
    // back to looking, and behaving, like the title chip it replaced.
    expect(MAIN).toContain('this.dom.docTabs.dataset["choice"]');
    expect(HTML).toContain('data-choice="false"');
    expect(CSS).toContain('.box-tabs[data-choice="true"] .box-tab[aria-selected="true"]');
    expect(CSS).toContain('.box-tabs[data-choice="false"]');
  });

  it("gives each document its own problems panel, and shows one at a time", () => {
    for (const id of ["program-problems", "map-problems-panel"]) {
      expect(HTML, id).toContain(`id="${id}"`);
    }
    // A report on the file in front: with the lesson in front there is none.
    expect(MAIN).toContain("this.dom.programProblems.hidden = map || lesson;");
    expect(MAIN).toContain("this.dom.mapProblemsPanel.hidden = !map");
    // `.problems` is a flex container, which beats the UA rule for [hidden].
    expect(CSS).toContain(".problems[hidden]");
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

  it("lays the bench out from one attribute, and styles every value it writes", () => {
    // main.ts writes `data-layout`; main.css is the only thing that reads it.
    expect(MAIN).toContain('this.dom.bench.dataset["layout"] = layout');
    // Every value the chrome can return has a block in the stylesheet, and
    // every one of them is returned by the chrome. `plain` is the default in
    // the markup and needs no block of its own.
    const written = [...MAIN.matchAll(/^\s*return "(plain|learn|level|guide|gallery)";$/gm)].map(
      (match) => match[1]
    );
    for (const layout of ["learn", "level", "guide", "gallery"]) {
      expect(written, layout).toContain(layout);
      expect(CSS, layout).toContain(`.bench[data-layout="${layout}"]`);
    }
    expect(written).toContain("plain");
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

/**
 * The two graded modes, arranged differently on purpose.
 *
 * A chapter is several paragraphs with worked examples in them, so it needs a
 * column — and takes turns with the program in one, because three columns
 * leave neither the lesson nor the world enough room. A level's brief is one
 * sentence, so it sits above the editor and costs it almost nothing. The
 * checks below are what stops the two from drifting back into one shape.
 */
describe("how much prose there is decides the arrangement", () => {
  it("gives learn a strip across the top of both columns", () => {
    for (const id of [
      "chapter-strip",
      "chapter-rail",
      "chapter-count",
      "chapter-name",
      "chapter-task",
      "chapter-verdict",
    ]) {
      expect(HTML, id).toContain(`id="${id}"`);
    }
    // Above both columns, which is only true if it is a child of the bench
    // ahead of them.
    expect(HTML.indexOf('id="chapter-strip"')).toBeGreaterThan(HTML.indexOf('id="bench"'));
    expect(HTML.indexOf('id="chapter-strip"')).toBeLessThan(HTML.indexOf('class="workshop"'));
    // A flex container beats the UA rule for [hidden], so it is unwound.
    expect(CSS).toContain(".strip[hidden]");
    // Two columns, and the strip across the top of them.
    const rule = CSS.slice(CSS.indexOf('.bench[data-layout="learn"] {'));
    expect(rule.slice(0, rule.indexOf("}"))).toContain("grid-template-rows: auto minmax(0, 1fr)");
    expect(CSS).toContain('.bench[data-layout="learn"] .strip');
  });

  it("puts the task and the verdict in the strip, never behind a tab", () => {
    // The whole reason the strip exists: the lesson takes turns with the
    // program, and neither the task nor the verdict may take turns with
    // anything. Both are written to the strip's own nodes.
    expect(MAIN).toContain("this.dom.chapterTask.textContent = chapter.task");
    // Asserted by intent rather than by exact expression: what matters is that
    // the verdict is written to the strip's own node and built by verdictNode,
    // not the shape of the call, which has already changed once.
    const writesVerdict = MAIN.slice(
      MAIN.indexOf("this.dom.chapterVerdict.replaceChildren("),
      MAIN.indexOf("this.dom.chapterVerdict.replaceChildren(") + 220
    );
    expect(writesVerdict).toContain("this.verdictNode()");
    // And the lesson pane no longer draws either of them.
    const lesson = MAIN.slice(
      MAIN.indexOf("private buildChapterGuide()"),
      MAIN.indexOf("private hintsNode(")
    );
    expect(lesson.length).toBeGreaterThan(200);
    expect(lesson).not.toContain("taskBox(");
    expect(lesson).not.toContain("verdictNode()");
    // The hints stay with the lesson, which is where a reader looks for them.
    expect(lesson).toContain("this.hintsNode(chapter.hints)");
  });

  it("opens an unsolved chapter on the lesson and a solved one on the program", () => {
    // A lesson behind a tab is a lesson a beginner can miss entirely.
    const opening = MAIN.slice(MAIN.indexOf("private openingDoc()"));
    const body = opening.slice(0, opening.indexOf("\n  }"));
    expect(body).toContain('this.progress.solved.includes(chapter.id) ? "program" : "lesson"');
    expect(body).toContain("this.learnDoc.get(chapter.id)");
    // And running the program brings the program to the front, or the active
    // line would be highlighted behind a lesson.
    expect(MAIN).toContain("this.showProgram();\n        void this.session.run();");
    expect(MAIN).toContain("this.showProgram();\n      this.session.step();");
  });

  it("stacks a level's brief above the program, capped rather than halved", () => {
    // Not halves: a one-line task in a box half a column tall is a lie about
    // how much there is to read, and a long one may not eat the editor.
    const bench = CSS.slice(CSS.indexOf('.bench[data-layout="level"] {'));
    expect(bench.slice(0, bench.indexOf("}"))).toContain("grid-template-rows: auto minmax(0, 1fr)");
    const brief = CSS.slice(CSS.indexOf('.bench[data-layout="level"] .guide {'));
    const rule = brief.slice(0, brief.indexOf("}"));
    expect(rule).toContain("grid-area: 1 / 1");
    expect(rule).toMatch(/max-height:\s*calc\(/);
    // The program is the row under it, and the world spans both.
    expect(CSS).toContain('.bench[data-layout="level"] .workshop');
    expect(CSS).toContain('.bench[data-layout="level"] .stage');
    // The brief scrolls inside the cap rather than pushing the editor down.
    // The unscoped rule, not the one the level layout tightens: the newline
    // pins it to the start of a selector.
    const scroll = CSS.slice(CSS.indexOf("\n.guide-scroll {"));
    expect(scroll.slice(0, scroll.indexOf("}"))).toContain("overflow-y: auto");
  });

  it("never cuts the map's tab in learn, nor the lesson's anywhere else", () => {
    // A chapter's world rearranged by hand is a check that certifies nothing;
    // a lesson tab in sandbox is a tab onto nothing at all.
    expect(MAIN).toContain("this.dom.lessonTab.hidden = !teaching");
    expect(MAIN).toContain('const teaching = this.mode === "learn"');
    expect(MAIN).toContain("this.dom.mapTab.hidden = !editable");
    // Two tabs is a choice worth marking; one is the title chip it replaced.
    expect(MAIN).toContain('this.dom.docTabs.dataset["choice"] = String(editable || teaching)');
  });

  it("leaves the world column alone in every mode", () => {
    // The one thing that must not move between modes: the stage is placed by
    // the layouts, never rebuilt, and nothing in it is mode-dependent.
    const stage = HTML.slice(HTML.indexOf('class="stage"'), HTML.indexOf('class="gallery"'));
    expect(stage).toContain('id="viewport"');
    expect(stage).toContain('id="world-canvas"');
    expect(stage).toContain('class="console"');
    expect(stage).toContain('id="readout"');
    // The strip and the prose box are siblings of the stage, not inside it.
    expect(stage).not.toContain('id="chapter-strip"');
    expect(stage).not.toContain('id="guide"');
  });
});
