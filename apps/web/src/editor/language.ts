/**
 * The Karel language, as CodeMirror sees it.
 *
 * Highlighting is driven by the core's `Lexer` rather than by a grammar
 * written for the editor. The repository already paid for the alternative
 * once: a TextMate grammar that listed the eighteen conditions a second time
 * and drifted from `VALID_CONDITIONS` the moment one of them changed. The core
 * exports `Lexer`, `Token` and `TokenType` precisely so a host can classify
 * words with the same code the parser uses, and there is no second list to
 * keep honest.
 */

import {
  StreamLanguage,
  StringStream,
  LanguageSupport,
  foldService,
  indentService,
  getIndentUnit,
} from "@codemirror/language";
import { Decoration, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { BUILT_IN_INSTRUCTIONS, Lexer, TokenType } from "@karel/core";

/** Karel has no block comments: everything after `//` is comment. */
const LINE_COMMENT = "//";

// ── Tokenizing one line ───────────────────────────────────────────────────

/**
 * A classified slice of a single line.
 *
 * `tag` is a Lezer highlight tag path, which is what a `StreamParser` is meant
 * to return; `className` is a class this project owns. Both come out of the
 * same pass because the editor paints with the class and the syntax tree
 * carries the tag (see `karelHighlighting` below for why both exist).
 */
export interface StyledToken {
  /** 0-based column of the first character. */
  from: number;
  /** 0-based column just past the last character. */
  to: number;
  /** Lezer highlight tag path, e.g. "controlKeyword". */
  tag: string;
  /** CSS class the stylesheet is expected to define. */
  className: string;
}

interface TokenStyle {
  tag: string;
  className: string;
}

/**
 * Every `TokenType` the lexer can produce, mapped once.
 *
 * `Identifier` is missing on purpose: telling a built-in from a user-defined
 * name needs the surrounding tokens, and that decision lives in `styleWord`.
 */
const STYLES: Partial<Record<TokenType, TokenStyle>> = {
  [TokenType.BeginningOfProgram]: { tag: "moduleKeyword", className: "cm-karel-program" },
  [TokenType.EndOfProgram]: { tag: "moduleKeyword", className: "cm-karel-program" },
  [TokenType.BeginningOfExecution]: { tag: "moduleKeyword", className: "cm-karel-program" },
  [TokenType.EndOfExecution]: { tag: "moduleKeyword", className: "cm-karel-program" },

  [TokenType.Begin]: { tag: "keyword", className: "cm-karel-block" },
  [TokenType.End]: { tag: "keyword", className: "cm-karel-block" },

  [TokenType.If]: { tag: "controlKeyword", className: "cm-karel-control" },
  [TokenType.Then]: { tag: "controlKeyword", className: "cm-karel-control" },
  [TokenType.Else]: { tag: "controlKeyword", className: "cm-karel-control" },
  [TokenType.While]: { tag: "controlKeyword", className: "cm-karel-control" },
  [TokenType.Do]: { tag: "controlKeyword", className: "cm-karel-control" },
  [TokenType.Iterate]: { tag: "controlKeyword", className: "cm-karel-control" },
  [TokenType.Times]: { tag: "controlKeyword", className: "cm-karel-control" },

  [TokenType.DefineNewInstruction]: { tag: "definitionKeyword", className: "cm-karel-define" },
  [TokenType.As]: { tag: "definitionKeyword", className: "cm-karel-define" },

  [TokenType.Condition]: { tag: "operatorKeyword", className: "cm-karel-condition" },
  [TokenType.Number]: { tag: "number", className: "cm-karel-number" },
  [TokenType.Semicolon]: { tag: "punctuation", className: "cm-karel-punctuation" },
};

const BUILT_IN_STYLE: TokenStyle = { tag: "variableName.standard", className: "cm-karel-builtin" };
const DEFINED_STYLE: TokenStyle = { tag: "variableName.definition", className: "cm-karel-defined" };
const NAME_STYLE: TokenStyle = { tag: "variableName", className: "cm-karel-name" };
const COMMENT_STYLE: TokenStyle = { tag: "lineComment", className: "cm-karel-comment" };

/**
 * A name is either one of the five primitives, the name being introduced by a
 * DEFINE-NEW-INSTRUCTION, or a call to something the student wrote. Only the
 * middle case needs context, and one token of lookbehind covers it: the name
 * always follows the keyword directly.
 */
function styleWord(value: string, previous: TokenType | null): TokenStyle {
  if (BUILT_IN_INSTRUCTIONS.has(value.toLowerCase())) {
    return BUILT_IN_STYLE;
  }
  return previous === TokenType.DefineNewInstruction ? DEFINED_STYLE : NAME_STYLE;
}

/**
 * Classify one line of source, in columns relative to that line.
 *
 * This is the whole reconciliation between the two tokenizers. `StreamLanguage`
 * hands out one line at a time through a `StringStream`, while the core `Lexer`
 * takes a whole document — but it splits on newlines and tokenizes each line
 * independently, with no state carried across them (Karel has no block
 * comments and no string literals, so there is nothing to carry). Feeding it a
 * single line therefore yields exactly the tokens that line contributes to a
 * full-document pass, with columns already relative to the line. No offset
 * arithmetic, no reimplemented word-splitting rules, no second keyword table.
 *
 * The one thing the lexer discards is the comment, which it strips before
 * scanning; it is re-added here from the same `//` rule.
 */
export function tokenizeLine(text: string): StyledToken[] {
  const styled: StyledToken[] = [];
  let previous: TokenType | null = null;

  for (const token of new Lexer(text).tokenize()) {
    if (token.type === TokenType.EOF) {
      break;
    }
    const style =
      token.type === TokenType.Identifier
        ? styleWord(token.value, previous)
        : (STYLES[token.type] ?? NAME_STYLE);
    styled.push({
      from: token.column,
      to: token.column + token.value.length,
      tag: style.tag,
      className: style.className,
    });
    previous = token.type;
  }

  const comment = text.indexOf(LINE_COMMENT);
  if (comment >= 0) {
    styled.push({
      from: comment,
      to: text.length,
      tag: COMMENT_STYLE.tag,
      className: COMMENT_STYLE.className,
    });
  }

  return styled;
}

// ── The stream parser ─────────────────────────────────────────────────────

interface KarelStreamState {
  /** The line the cached tokens were produced from, or null before the first. */
  text: string | null;
  tokens: StyledToken[];
}

/**
 * Blocks are the only foldable and indentable structures, and both ends of
 * each pair are literal words, so plain patterns do the job. They are the
 * `brackets` from the VS Code extension's language-configuration.json, kept in
 * step with it deliberately.
 */
const BLOCK_OPEN = /^\s*(BEGIN|BEGINNING-OF-PROGRAM|BEGINNING-OF-EXECUTION)\b/i;
const BLOCK_CLOSE = /^\s*(END|END-OF-PROGRAM|END-OF-EXECUTION)\b/i;

/**
 * Re-indent as soon as the closing word is complete, the way the VS Code
 * extension's `decreaseIndentPattern` does, so END snaps back under its BEGIN
 * without the student reaching for backspace.
 */
const DEDENT_ON_INPUT = /^\s*(END|END-OF-PROGRAM|END-OF-EXECUTION)$/i;

export const karelLanguage = StreamLanguage.define<KarelStreamState>({
  name: "karel",

  startState: () => ({ text: null, tokens: [] }),

  token(stream: StringStream, state: KarelStreamState): string | null {
    // The parser walks a line token by token, so the line is lexed once and
    // the result answers every call until the stream moves to another one.
    if (state.text !== stream.string) {
      state.text = stream.string;
      state.tokens = tokenizeLine(stream.string);
    }

    // Karel lines are short enough that a scan beats keeping a cursor in the
    // state, which would have to survive copyState and re-parses from a
    // checkpoint.
    const token = state.tokens.find((candidate) => candidate.from === stream.pos);
    if (token) {
      stream.pos = token.to;
      return token.tag;
    }

    // Whatever the lexer skipped: whitespace, and nothing else today. The
    // single-character fallback is what keeps the contract that `token` always
    // advances the stream, however the lexer changes.
    if (stream.eatSpace()) {
      return null;
    }
    stream.next();
    return null;
  },

  languageData: {
    commentTokens: { line: LINE_COMMENT },
    // Without this, a double click on `front-is-clear` selects `is`: the
    // default word characters stop at the hyphen, and every condition in the
    // language is hyphenated. The VS Code extension solves the same problem
    // with its `wordPattern`.
    wordChars: "-",
    indentOnInput: DEDENT_ON_INPUT,
  },
});

// ── Indentation and folding ───────────────────────────────────────────────

/**
 * Indent one unit inside a block and put the closing word back where the
 * opening one is. Reading the previous line rather than the syntax tree keeps
 * this working while the program is half-typed and does not parse.
 */
const karelIndent = indentService.of((context, pos) => {
  const line = context.state.doc.lineAt(pos);
  if (line.number === 1) {
    return 0;
  }

  const previous = context.state.doc.line(line.number - 1);
  const unit = getIndentUnit(context.state);
  let indent = context.lineIndent(previous.from);

  if (BLOCK_OPEN.test(previous.text)) {
    indent += unit;
  }
  if (BLOCK_CLOSE.test(line.text)) {
    indent -= unit;
  }
  return Math.max(0, indent);
});

/**
 * Fold a block from the end of its opening line to the indentation of its
 * closing one, so a collapsed block still reads as `BEGIN…END`.
 *
 * Only the BEGIN/END family is counted. IF, WHILE and ITERATE open a *logical*
 * block but are not closed by END themselves — their body is a BEGIN — so
 * counting them, as the VS Code folding markers do, would pair the wrong ends.
 */
const karelFolding = foldService.of((state, lineStart, lineEnd) => {
  const doc = state.doc;
  const opening = doc.lineAt(lineStart);
  if (!BLOCK_OPEN.test(opening.text)) {
    return null;
  }

  let depth = 1;
  for (let number = opening.number + 1; number <= doc.lines; number++) {
    const line = doc.line(number);
    if (BLOCK_OPEN.test(line.text)) {
      depth++;
    } else if (BLOCK_CLOSE.test(line.text)) {
      depth--;
      if (depth === 0) {
        const indent = /^\s*/.exec(line.text)![0].length;
        const to = line.from + indent;
        return to > lineEnd ? { from: lineEnd, to } : null;
      }
    }
  }
  return null;
});

// ── Highlighting ──────────────────────────────────────────────────────────

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
      for (const token of tokenizeLine(line.text)) {
        builder.add(line.from + token.from, line.from + token.to, markFor(token.className));
      }
    }
  }

  return builder.finish();
}

/**
 * Paint the tokens with classes this project names.
 *
 * The usual route — a `HighlightStyle` over Lezer tags — cannot be taken here
 * for two reasons. The first is the house rule: a `HighlightStyle` holds
 * colours, in TypeScript, which is exactly the duplication the CSS custom
 * properties exist to prevent. The second is practical: mapping tags to
 * classes instead of colours needs the `tags` objects from `@lezer/highlight`,
 * and that package is a transitive dependency of `@codemirror/language`, not a
 * direct one, so under pnpm it is not resolvable from here.
 *
 * Decorating from the same `tokenizeLine` costs one pass over the visible
 * lines and gives the stylesheet class names it chose, which is a better deal
 * than either alternative. The tags on the syntax tree stay correct and unused,
 * ready for anything that reads them later.
 */
export const karelHighlighting: Extension = ViewPlugin.fromClass(
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

/** Everything the editor needs to speak Karel. */
export function karel(): LanguageSupport {
  return new LanguageSupport(karelLanguage, [karelIndent, karelFolding, karelHighlighting]);
}
