/**
 * The world as text: the .klm file behind the map editor, open for editing.
 *
 * A map you can only draw is a map you can only draw approximately. Nudging a
 * wall by one corner, moving a beeper pile from (5, 1) to (5, 2), lining up
 * the far edge of a maze — all of it is one keystroke in the file and a
 * careful aim with a pointer, and the file is what the CLI and the extension
 * read anyway. So the palette gets a second face: the same world, written out,
 * bidirectional.
 *
 * Three things live here, in this order:
 *
 *   1. A canonical printer. Two equal worlds always print the same bytes,
 *      whatever order the edits that built them happened in. This is what
 *      makes the round trip safe: the canvas can rewrite the panel after
 *      every gesture without the text reshuffling under the reader's eyes,
 *      because an unchanged world produces an unchanged document and the
 *      editor is never asked to replace it.
 *   2. A reader that never throws and reports where it stopped, so a
 *      half-typed file is a list of problems rather than a blank canvas.
 *      Validation is `validateKarelMap` from the core and nothing else: the
 *      panel must accept exactly the files the CLI accepts, no more.
 *   3. A small CodeMirror host, assembled the way editor.ts assembles the
 *      program's. It deliberately does not share that file's factory — see
 *      `createMapSourceEditor` for why — but it does share the one piece of
 *      it that is genuinely general, `diagnosticRange`.
 */

import { validateKarelMap, type Diagnostic, type KarelMap, type Wall } from "@karel/core";
import { minimalSetup } from "codemirror";
import { Compartment, EditorState, RangeSetBuilder } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, lineNumbers } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import { syntaxHighlighting } from "@codemirror/language";
import { setDiagnostics as setLintDiagnostics } from "@codemirror/lint";
import type { Diagnostic as LintDiagnostic } from "@codemirror/lint";

import { diagnosticRange } from "./editor/editor.js";
import { t } from "./i18n.js";

// ── Canonical form ────────────────────────────────────────────────────────

/**
 * A wall read from its lower end first.
 *
 * The two cells either side of a boundary name the same wall in either order —
 * the core's own `wallKey` says so — so which one a click happened to store as
 * `from` is noise. Fixing it here means a wall drawn left-to-right and the
 * same wall drawn right-to-left are one line of text, not two spellings of it.
 */
function orientWall(wall: Wall): Wall {
  const forward =
    wall.from.x < wall.to.x || (wall.from.x === wall.to.x && wall.from.y <= wall.to.y);
  const [from, to] = forward ? [wall.from, wall.to] : [wall.to, wall.from];
  return { from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y } };
}

/** Bottom row first, left to right: the order the world is read in. */
function byPosition(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return a.y - b.y || a.x - b.x;
}

/**
 * The same world, in one fixed arrangement.
 *
 * Every edit in draft.ts appends: a beeper added last sits last in the array,
 * a wall removed and drawn again moves to the end. That is invisible on the
 * canvas and glaring in a file, where it would show up as the whole document
 * shifting because one pile changed. Sorting on the way out makes the text a
 * function of the world alone.
 */
export function canonicalWorld(world: KarelMap): KarelMap {
  return {
    dimensions: { width: world.dimensions.width, height: world.dimensions.height },
    karel: {
      x: world.karel.x,
      y: world.karel.y,
      facing: world.karel.facing,
      beepers: world.karel.beepers,
    },
    beepers: world.beepers.map((b) => ({ x: b.x, y: b.y, count: b.count })).sort(byPosition),
    walls: world.walls
      .map(orientWall)
      .sort((a, b) => byPosition(a.from, b.from) || byPosition(a.to, b.to)),
  };
}

/** `{ "x": 1, "y": 2 }` — one entry, on one line, spaced the way a person writes it. */
function inline(entries: [string, number | string][]): string {
  const pairs = entries.map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`);
  return `{ ${pairs.join(", ")} }`;
}

function inlineWall(wall: Wall): string {
  const from = inline([
    ["x", wall.from.x],
    ["y", wall.from.y],
  ]);
  const to = inline([
    ["x", wall.to.x],
    ["y", wall.to.y],
  ]);
  return `{ "from": ${from}, "to": ${to} }`;
}

/** `"beepers": [ … ]`, empty as `[]` and otherwise one entry per line. */
function block(name: string, entries: string[]): string {
  if (entries.length === 0) {
    return `  ${JSON.stringify(name)}: []`;
  }
  return `  ${JSON.stringify(name)}: [\n${entries.map((e) => `    ${e}`).join(",\n")}\n  ]`;
}

/**
 * The world as the text of a .klm file: valid JSON, stable, and laid out the
 * way the levels in this repository are written by hand — the small records on
 * one line each, so a maze reads as a list of walls rather than as four
 * hundred lines of coordinates.
 *
 * No trailing newline: this is an editor document, and a file that ends in one
 * would show an empty last line every time the panel was refilled. The
 * download path adds it back.
 */
export function serializeWorld(world: KarelMap): string {
  const map = canonicalWorld(world);
  const lines = [
    "{",
    `  "dimensions": ${inline([
      ["width", map.dimensions.width],
      ["height", map.dimensions.height],
    ])},`,
    `  "karel": ${inline([
      ["x", map.karel.x],
      ["y", map.karel.y],
      ["facing", map.karel.facing],
      ["beepers", map.karel.beepers],
    ])},`,
    `${block(
      "beepers",
      map.beepers.map((b) =>
        inline([
          ["x", b.x],
          ["y", b.y],
          ["count", b.count],
        ])
      )
    )},`,
    block("walls", map.walls.map(inlineWall)),
    "}",
  ];
  return lines.join("\n");
}

/** Do these two describe the same world? Asked of the text, so it is exact. */
export function sameWorld(a: KarelMap, b: KarelMap): boolean {
  return serializeWorld(a) === serializeWorld(b);
}

// ── Reading it back ───────────────────────────────────────────────────────

/**
 * One thing wrong with the document.
 *
 * `line` and `column` follow the core's convention — 1-based line, 0-based
 * column — so the panel prints them exactly as the program's problems are
 * printed. Both are null when nothing honest can be said about where the
 * problem is: `validateKarelMap` reports what is wrong with a world, not where
 * in a file it was written, and guessing a line by matching translated prose
 * would point confidently at the wrong one.
 */
export interface MapProblem {
  message: string;
  line: number | null;
  column: number | null;
}

export type MapSourceResult = { ok: true; world: KarelMap } | { ok: false; problems: MapProblem[] };

/** Absolute offset to the line and column a person would count to. */
function locate(text: string, offset: number): { line: number; column: number } {
  const clamped = Math.max(0, Math.min(offset, text.length));
  const before = text.slice(0, clamped);
  const line = before.split("\n").length;
  const column = clamped - (before.lastIndexOf("\n") + 1);
  return { line, column };
}

/**
 * Where the engine says the JSON stopped making sense.
 *
 * Every engine words this differently and two of the three carry a position;
 * both spellings are read here, and a browser that gives neither (WebKit says
 * only "JSON Parse error: …") leaves the problem without a position rather
 * than with an invented one.
 */
function syntaxProblem(text: string, error: Error): MapProblem {
  const message = t("error.notJson", { message: error.message });

  const offset = /position (\d+)/.exec(error.message);
  if (offset) {
    const { line, column } = locate(text, Number(offset[1]));
    return { message, line, column };
  }
  // Firefox, and newer V8 alongside the offset: "at line 3 column 5".
  const at = /line (\d+) column (\d+)/.exec(error.message);
  if (at) {
    return { message, line: Number(at[1]), column: Math.max(0, Number(at[2]) - 1) };
  }
  return { message, line: null, column: null };
}

/**
 * Read the panel's text as a world.
 *
 * Never throws, because it is called on every keystroke: half a document is
 * the normal state of a document being typed, and the caller's answer to it is
 * to keep showing the last world that did parse.
 */
export function parseMapSource(text: string): MapSourceResult {
  let data: unknown;
  try {
    data = JSON.parse(text) as unknown;
  } catch (error) {
    return { ok: false, problems: [syntaxProblem(text, error as Error)] };
  }

  const validated = validateKarelMap(data);
  if (!validated.ok || !validated.map) {
    return {
      ok: false,
      problems: validated.errors.map((message) => ({ message, line: null, column: null })),
    };
  }
  return { ok: true, world: validated.map };
}

// ── Highlighting ──────────────────────────────────────────────────────────

interface StyledToken {
  from: number;
  to: number;
  className: string;
}

const NUMBER = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const WORD = /[a-zA-Z]+/y;

/**
 * Classify one line of JSON.
 *
 * A line is enough context because JSON has no construct that spans one: a
 * string cannot contain a raw newline and there are no comments. That is the
 * same property the program's highlighter relies on, and it is why both can be
 * a plain per-line scan instead of a parser with state to carry.
 *
 * The only distinction that needs lookahead is the one worth drawing: a string
 * followed by a colon is a key, and keys are the shape of the file.
 */
function tokenizeJsonLine(text: string): StyledToken[] {
  const tokens: StyledToken[] = [];
  let at = 0;

  while (at < text.length) {
    const character = text[at];

    if (character === '"') {
      let end = at + 1;
      while (end < text.length) {
        if (text[end] === "\\") {
          end += 2;
          continue;
        }
        if (text[end] === '"') {
          end += 1;
          break;
        }
        end += 1;
      }
      let after = Math.min(end, text.length);
      while (after < text.length && /\s/.test(text[after])) {
        after += 1;
      }
      tokens.push({
        from: at,
        to: Math.min(end, text.length),
        className: text[after] === ":" ? "cm-json-key" : "cm-json-string",
      });
      at = Math.min(end, text.length);
      continue;
    }

    if (character === "-" || (character >= "0" && character <= "9")) {
      NUMBER.lastIndex = at;
      const match = NUMBER.exec(text);
      if (match) {
        tokens.push({ from: at, to: at + match[0].length, className: "cm-json-number" });
        at += match[0].length;
        continue;
      }
    }

    WORD.lastIndex = at;
    const word = WORD.exec(text);
    if (word) {
      tokens.push({ from: at, to: at + word[0].length, className: "cm-json-atom" });
      at += word[0].length;
      continue;
    }

    if ("{}[],:".includes(character)) {
      tokens.push({ from: at, to: at + 1, className: "cm-json-punctuation" });
    }
    at += 1;
  }

  return tokens;
}

const MARKS = new Map<string, Decoration>();

function markFor(className: string): Decoration {
  let mark = MARKS.get(className);
  if (!mark) {
    mark = Decoration.mark({ class: className });
    MARKS.set(className, mark);
  }
  return mark;
}

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;

  for (const { from, to } of view.visibleRanges) {
    let number = doc.lineAt(from).number;
    const last = doc.lineAt(to).number;
    for (; number <= last; number++) {
      const line = doc.line(number);
      for (const token of tokenizeJsonLine(line.text)) {
        builder.add(line.from + token.from, line.from + token.to, markFor(token.className));
      }
    }
  }

  return builder.finish();
}

/**
 * Paint the tokens with classes the stylesheet owns, for the same two reasons
 * the program's highlighter does it this way: a `HighlightStyle` would hold
 * colours in TypeScript that the CSS custom properties already hold, and the
 * `@lezer/highlight` tags it needs are not resolvable from this package.
 */
const jsonHighlighting: Extension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations }
);

// ── The editor ────────────────────────────────────────────────────────────

export interface MapSourceEditor {
  getText(): string;
  /**
   * Replace the document, unless it already says this.
   *
   * Returns whether anything was written, and does not notify `onChange`: see
   * the note on the echo guard in `createMapSourceEditor`.
   */
  setText(text: string): boolean;
  setProblems(problems: MapProblem[]): void;
  setEditable(editable: boolean): void;
  /** Called for edits a person made, never for a `setText`. */
  onChange(listener: (text: string) => void): void;
  focus(): void;
}

function editableExtension(value: boolean): Extension {
  return [EditorState.readOnly.of(!value), EditorView.editable.of(value)];
}

function toLintDiagnostic(view: EditorView, problem: MapProblem): LintDiagnostic | null {
  if (problem.line === null || problem.column === null) {
    return null;
  }
  const diagnostic: Diagnostic = {
    message: problem.message,
    line: problem.line,
    column: problem.column,
    severity: "error",
  };
  const { from, to } = diagnosticRange(view.state.doc, diagnostic);
  return { from, to, severity: "error", message: problem.message, source: "klm" };
}

/**
 * A CodeMirror view for the world's own file.
 *
 * Not `createEditor` with a different language: that editor answers to the
 * interpreter — an executing line, editing locked while a program runs — and
 * this one answers to a validator, with an echo guard the program editor has
 * no use for. The overlap is the assembly of a `minimalSetup` view and the
 * clamping of a diagnostic's range onto a document, and only the second is
 * general enough to share, so it is imported and the rest is written out.
 * Twenty lines twice is cheaper than one factory with two personalities.
 *
 * The echo guard is the first of the two things that keep the canvas and this
 * panel from writing to each other for ever: `setText` dispatches
 * synchronously, so a flag raised around the dispatch is enough to tell the
 * update listener that this change came from the application rather than from
 * a person, and only a person's edits are reported. The second half of the
 * rule lives in the caller, which decides when the panel may be refilled at
 * all.
 */
export function createMapSourceEditor(parent: HTMLElement, initial: string): MapSourceEditor {
  const listeners: ((text: string) => void)[] = [];
  const editable = new Compartment();
  let echo = false;

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: initial,
      extensions: [
        minimalSetup,
        // Displaces the default highlighter `minimalSetup` installs, which
        // carries CodeMirror's own hard-coded palette. The classes above paint
        // instead.
        syntaxHighlighting({ style: () => null }),
        lineNumbers(),
        EditorView.lineWrapping,
        EditorState.tabSize.of(2),
        jsonHighlighting,
        editable.of(editableExtension(true)),
        EditorView.updateListener.of((update: ViewUpdate) => {
          if (!update.docChanged || echo) {
            return;
          }
          const text = update.state.doc.toString();
          for (const listener of listeners) {
            listener(text);
          }
        }),
      ],
    }),
  });

  return {
    getText: () => view.state.doc.toString(),

    setText(text) {
      if (text === view.state.doc.toString()) {
        return false;
      }
      echo = true;
      try {
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: text },
          // Any position the caller held is gone with the document it pointed
          // into; the top is the only honest place to leave the caret.
          selection: { anchor: 0 },
        });
      } finally {
        echo = false;
      }
      return true;
    },

    setProblems(problems) {
      const lint = problems
        .map((problem) => toLintDiagnostic(view, problem))
        .filter((diagnostic): diagnostic is LintDiagnostic => diagnostic !== null);
      view.dispatch(setLintDiagnostics(view.state, lint));
    },

    setEditable(value) {
      view.dispatch({ effects: editable.reconfigure(editableExtension(value)) });
    },

    onChange(listener) {
      listeners.push(listener);
    },

    focus() {
      view.focus();
    },
  };
}
