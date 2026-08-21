import { describe, expect, it } from "vitest";
import { Text } from "@codemirror/state";
import type { Diagnostic } from "@karel/core";

import { diagnosticRange } from "../src/editor/editor";
import type { DocumentLines } from "../src/editor/editor";
import { tokenizeLine } from "../src/editor/language";

/**
 * `Text` is what the editor passes at runtime; using it here keeps the test
 * honest about the shape of `DocumentLines` instead of only exercising a stub.
 */
function doc(source: string): DocumentLines {
  return Text.of(source.split("\n"));
}

function error(line: number, column: number, endColumn?: number): Diagnostic {
  return { message: "boom", line, column, endColumn, severity: "error" };
}

describe("diagnosticRange", () => {
  it("offsets a mid-document range by the start of its line", () => {
    // "move\n" is 5 characters, so line 2 starts at 5.
    const range = diagnosticRange(doc("move\nturnleft\nmove"), error(2, 0, 8));
    expect(range).toEqual({ from: 5, to: 13 });
  });

  it("covers to the end of the line when endColumn is missing", () => {
    const range = diagnosticRange(doc("BEGIN\n  turnleft"), error(2, 2));
    expect(range).toEqual({ from: 8, to: 16 });
  });

  it("clamps a line past the end of the document onto the last line", () => {
    const source = "move\nturnleft";
    const range = diagnosticRange(doc(source), error(99, 0));
    expect(range).toEqual({ from: 5, to: 13 });
  });

  it("clamps a line below one onto the first line", () => {
    const range = diagnosticRange(doc("move\nturnleft"), error(0, 0, 4));
    expect(range).toEqual({ from: 0, to: 4 });
  });

  it("clamps a column past the end of its line", () => {
    // An unexpected end of input reports the column after the last character,
    // where there is nothing left to mark: the range steps back one.
    const range = diagnosticRange(doc("move"), error(1, 40, 44));
    expect(range).toEqual({ from: 3, to: 4 });
  });

  it("never produces a backwards range when endColumn precedes column", () => {
    const range = diagnosticRange(doc("turnleft"), error(1, 6, 2));
    expect(range.to).toBeGreaterThanOrEqual(range.from);
    expect(range).toEqual({ from: 6, to: 7 });
  });

  it("widens a zero-width range to one character", () => {
    const range = diagnosticRange(doc("move"), error(1, 2, 2));
    expect(range).toEqual({ from: 2, to: 3 });
  });

  it("stays inside the document when the last line is empty", () => {
    // Nothing to mark and nowhere to back into, so an empty range is the only
    // honest answer; the lint extension accepts one.
    const source = "move\n";
    expect(diagnosticRange(doc(source), error(2, 0))).toEqual({ from: 5, to: 5 });
    expect(source.length).toBe(5);
  });

  it("survives an empty document", () => {
    const range = diagnosticRange(doc(""), error(1, 0));
    expect(range).toEqual({ from: 0, to: 0 });
  });
});

describe("tokenizeLine", () => {
  const classes = (text: string) => tokenizeLine(text).map((token) => token.className);
  const at = (text: string, column: number) =>
    tokenizeLine(text).find((token) => token.from === column);

  it("reports columns relative to the line, not the document", () => {
    expect(tokenizeLine("  move;")).toEqual([
      { from: 2, to: 6, tag: "variableName.standard", className: "cm-karel-builtin" },
      { from: 6, to: 7, tag: "punctuation", className: "cm-karel-punctuation" },
    ]);
  });

  it("separates the keyword families", () => {
    expect(at("BEGINNING-OF-PROGRAM", 0)?.className).toBe("cm-karel-program");
    expect(at("BEGIN", 0)?.className).toBe("cm-karel-block");
    expect(at("WHILE front-is-clear DO", 0)?.className).toBe("cm-karel-control");
    expect(at("DEFINE-NEW-INSTRUCTION turnright AS", 0)?.className).toBe("cm-karel-define");
  });

  it("keeps a hyphenated condition as one token", () => {
    const condition = at("WHILE front-is-clear DO", 6);
    expect(condition).toMatchObject({ to: 20, className: "cm-karel-condition" });
  });

  it("tells the name being defined from a call to it", () => {
    expect(at("DEFINE-NEW-INSTRUCTION turnright AS", 23)?.className).toBe("cm-karel-defined");
    expect(at("turnright;", 0)?.className).toBe("cm-karel-name");
  });

  it("knows the five built-in instructions", () => {
    for (const instruction of ["move", "turnleft", "pickbeeper", "putbeeper", "turnoff"]) {
      expect(at(instruction, 0)?.className).toBe("cm-karel-builtin");
    }
  });

  it("marks iteration counts as numbers", () => {
    expect(at("ITERATE 12 TIMES", 8)).toMatchObject({ to: 10, className: "cm-karel-number" });
  });

  it("is case-insensitive about keywords, as the lexer is", () => {
    expect(at("iterate 2 times", 0)?.className).toBe("cm-karel-control");
  });

  it("runs a comment to the end of the line and stops tokenizing there", () => {
    const tokens = tokenizeLine("move; // turn around here");
    expect(tokens.at(-1)).toEqual({
      from: 6,
      to: 25,
      tag: "lineComment",
      className: "cm-karel-comment",
    });
    // `turn` inside the comment must not be classified as anything else.
    expect(classes("move; // turn around here")).toEqual([
      "cm-karel-builtin",
      "cm-karel-punctuation",
      "cm-karel-comment",
    ]);
  });

  it("handles a whole-line comment and a blank line", () => {
    expect(tokenizeLine("// nothing to see")).toEqual([
      { from: 0, to: 17, tag: "lineComment", className: "cm-karel-comment" },
    ]);
    expect(tokenizeLine("")).toEqual([]);
    expect(tokenizeLine("   ")).toEqual([]);
  });

  it("produces tokens in column order, which the decoration builder relies on", () => {
    const tokens = tokenizeLine("IF next-to-a-beeper THEN // pick it up");
    for (let i = 1; i < tokens.length; i++) {
      expect(tokens[i].from).toBeGreaterThanOrEqual(tokens[i - 1].to);
    }
  });
});
