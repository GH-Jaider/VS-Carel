/**
 * The program editor: CodeMirror 6 wearing the project's clothes.
 *
 * Nothing in here names a colour. The extension list is assembled by hand
 * rather than taken from `basicSetup` so that no stylesheet arrives with it —
 * everything visible is a class the project's CSS owns. See the class list at
 * the bottom of this file for what the stylesheet is expected to define.
 */

import { minimalSetup } from "codemirror";
import {
  Compartment,
  EditorSelection,
  EditorState,
  Prec,
  StateEffect,
  StateField,
} from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { Decoration, EditorView, keymap, lineNumbers } from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import {
  getIndentUnit,
  indentOnInput,
  indentString,
  indentUnit,
  syntaxHighlighting,
} from "@codemirror/language";
import { setDiagnostics as setLintDiagnostics } from "@codemirror/lint";
import type { Diagnostic as LintDiagnostic } from "@codemirror/lint";
import type { Diagnostic as KarelDiagnostic } from "@karel/core";

import type { KarelEditor } from "../contracts";
import { karel } from "./language";

/** Karel programs in this repository are indented with tabs; keep writing them that way. */
const INDENT_UNIT = "\t";
const TAB_SIZE = 4;

// ── Diagnostics ───────────────────────────────────────────────────────────

/**
 * The part of CodeMirror's `Text` that the range conversion needs.
 *
 * Declared structurally so the conversion can be tested with a plain object,
 * without a document, a view or a DOM. `Text` satisfies it as it stands.
 */
export interface DocumentLines {
  /** Total characters, used to keep a range inside the document. */
  length: number;
  /** Number of lines; always at least 1. */
  lines: number;
  line(number: number): { from: number; length: number };
}

/**
 * Turn a core `Diagnostic` — 1-based line, 0-based column — into the absolute
 * offsets CodeMirror ranges are made of.
 *
 * The clamping rules are the ones the VS Code extension arrived at in
 * `toVSCodeDiagnostic`, and for the same reason: a diagnostic can point one
 * past the end of a line (an unexpected end of file does), at a line that no
 * longer exists (the document changed before the parse landed), or at a single
 * position with no `endColumn`. An editor asked to mark a range it cannot
 * resolve throws, so the range is squeezed into the document here instead.
 *
 * The one rule VS Code does not need is the last: it clamps ranges to the
 * document itself, CodeMirror does not, so the end is pinned to the document
 * length as well.
 */
export function diagnosticRange(
  doc: DocumentLines,
  diagnostic: KarelDiagnostic
): { from: number; to: number } {
  const lineNumber = Math.min(Math.max(1, diagnostic.line), doc.lines);
  const line = doc.line(lineNumber);

  const startColumn = Math.min(Math.max(0, diagnostic.column), line.length);
  const endColumn = Math.min(
    diagnostic.endColumn ?? line.length,
    Math.max(line.length, startColumn + 1)
  );

  let from = Math.min(line.from + startColumn, doc.length);
  const to = Math.max(from, Math.min(line.from + Math.max(endColumn, startColumn + 1), doc.length));

  // A zero-width mark draws nothing, and the whole point is to show the
  // student where to look. Only the end of the document can collapse a range
  // this far — "unexpected end of program" always lands there — so it steps
  // back onto the last character of the line, never off it.
  if (to === from && from > line.from) {
    from -= 1;
  }

  return { from, to };
}

function toLintDiagnostic(doc: DocumentLines, diagnostic: KarelDiagnostic): LintDiagnostic {
  const { from, to } = diagnosticRange(doc, diagnostic);
  return {
    from,
    to,
    severity: diagnostic.severity,
    message: diagnostic.message,
    source: "karel",
  };
}

// ── The executing line ────────────────────────────────────────────────────

/** Null clears the mark, which is what the idle and finished states want. */
const setActiveLine = StateEffect.define<number | null>();

const activeLineMark = Decoration.line({ class: "cm-activeKarelLine" });

const activeLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, transaction) {
    // Mapping first keeps the mark on the right line if the document moved
    // under it — which it can, since a run can be paused and the source edited.
    decorations = decorations.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(setActiveLine)) {
        continue;
      }
      if (effect.value === null) {
        return Decoration.none;
      }
      const line = transaction.state.doc.line(
        Math.min(Math.max(1, effect.value), transaction.state.doc.lines)
      );
      return Decoration.set([activeLineMark.range(line.from)]);
    }
    return decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

// ── Keys ──────────────────────────────────────────────────────────────────

/**
 * Tab indents rather than moving focus. Karel programs are nested three or
 * four levels deep and are read as much as they are run, so indentation has to
 * be reachable; the editor is a text area with a visible caret, so a student
 * who lands in it expects Tab to type.
 */
const indentKeys = keymap.of([
  {
    key: "Tab",
    run: (view) => {
      const unit = indentString(view.state, getIndentUnit(view.state));
      view.dispatch(
        view.state.changeByRange((range) => ({
          changes: { from: range.from, to: range.to, insert: unit },
          range: EditorSelection.cursor(range.from + unit.length),
        })),
        { userEvent: "input.indent" }
      );
      return true;
    },
  },
  {
    key: "Shift-Tab",
    run: (view) => {
      const changes = view.state.changeByRange((range) => {
        const line = view.state.doc.lineAt(range.from);
        const indent = /^[ \t]*/.exec(line.text)![0];
        if (!indent) {
          return { range };
        }
        const removed = indent.endsWith("\t") ? 1 : Math.min(indent.length, TAB_SIZE);
        return {
          changes: { from: line.from + indent.length - removed, to: line.from + indent.length },
          range: EditorSelection.cursor(Math.max(line.from, range.from - removed)),
        };
      });
      view.dispatch(changes, { userEvent: "delete.dedent" });
      return true;
    },
  },
]);

/**
 * The application owns Cmd/Ctrl+Enter (run) and Cmd/Ctrl+. (step), and listens
 * for them outside the editor. CodeMirror's default keymap binds Mod-Enter to
 * `insertBlankLine`, which would split the student's program every time they
 * asked it to run, so both are claimed here and deliberately do nothing:
 * claiming the key stops the default binding, and CodeMirror only calls
 * `preventDefault` — it does not stop propagation — so the event still reaches
 * the application's handler.
 */
const reservedKeys = Prec.highest(
  keymap.of([
    { key: "Mod-Enter", run: () => true },
    { key: "Mod-.", run: () => true },
  ])
);

// ── The editor ────────────────────────────────────────────────────────────

export function createEditor(parent: HTMLElement, initial: string): KarelEditor {
  const listeners: ((source: string) => void)[] = [];
  const editable = new Compartment();

  const extensions: Extension[] = [
    minimalSetup,
    // A highlighter that styles nothing, at normal precedence, which is enough
    // to displace the default one `minimalSetup` installs as a fallback. That
    // default carries CodeMirror's own palette in hard-coded hexes; the tokens
    // are painted instead by classes from language.ts, over CSS custom
    // properties.
    syntaxHighlighting({ style: () => null }),
    lineNumbers(),
    EditorView.lineWrapping,
    indentUnit.of(INDENT_UNIT),
    EditorState.tabSize.of(TAB_SIZE),
    indentOnInput(),
    karel(),
    activeLineField,
    reservedKeys,
    indentKeys,
    editable.of(editableExtension(true)),
    EditorView.updateListener.of((update: ViewUpdate) => {
      if (!update.docChanged) {
        return;
      }
      const source = update.state.doc.toString();
      for (const listener of listeners) {
        listener(source);
      }
    }),
  ];

  const view = new EditorView({
    parent,
    state: EditorState.create({ doc: initial, extensions }),
  });

  return {
    getSource: () => view.state.doc.toString(),

    setSource(source) {
      if (source === view.state.doc.toString()) {
        return;
      }
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: source },
        // Replacing the whole document invalidates any position the caller
        // held; putting the caret at the top is the only honest answer.
        selection: { anchor: 0 },
      });
    },

    setDiagnostics(diagnostics) {
      const doc = view.state.doc;
      view.dispatch(
        setLintDiagnostics(
          view.state,
          diagnostics.map((diagnostic) => toLintDiagnostic(doc, diagnostic))
        )
      );
    },

    setActiveLine(line) {
      const effects: StateEffect<unknown>[] = [setActiveLine.of(line)];
      if (line !== null) {
        const target = view.state.doc.line(Math.min(Math.max(1, line), view.state.doc.lines));
        effects.push(EditorView.scrollIntoView(target.from, { y: "center" }));
      }
      view.dispatch({ effects });
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

/**
 * Both facets, not just one: `readOnly` refuses edits from commands and
 * `editable` takes the element out of the tab order and off the caret, so a
 * running program cannot be typed into by any route.
 */
function editableExtension(value: boolean): Extension {
  return [EditorState.readOnly.of(!value), EditorView.editable.of(value)];
}
