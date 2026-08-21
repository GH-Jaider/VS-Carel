import { describe, expect, it } from "vitest";

import { Lexer, TokenType, VALID_CONDITIONS } from "../src/index";
import type { Token } from "../src/index";
import { DEMO_PROGRAM_SOURCE } from "./helpers";

function lex(source: string): Token[] {
  return new Lexer(source).tokenize();
}

/** Tokens without the trailing EOF, which every stream ends with. */
function body(source: string): Token[] {
  const tokens = lex(source);
  return tokens.slice(0, -1);
}

function typesOf(tokens: Token[]): TokenType[] {
  return tokens.map((token) => token.type);
}

function valuesOf(tokens: Token[]): string[] {
  return tokens.map((token) => token.value);
}

const FULL_PROGRAM = [
  "BEGINNING-OF-PROGRAM",
  "  DEFINE-NEW-INSTRUCTION turnright AS",
  "  BEGIN",
  "    turnleft;",
  "    IF front-is-clear THEN move ELSE turnleft;",
  "    WHILE next-to-a-beeper DO pickbeeper;",
  "    ITERATE 3 TIMES move",
  "  END",
  "  BEGINNING-OF-EXECUTION",
  "    turnright;",
  "    turnoff",
  "  END-OF-EXECUTION",
  "END-OF-PROGRAM",
].join("\n");

describe("Lexer", () => {
  describe("token types", () => {
    it("emits every member of the TokenType enum for a program that uses the whole language", () => {
      const produced = new Set(typesOf(lex(FULL_PROGRAM)));
      // Guards against a TokenType being added to the enum but never produced,
      // and against one silently disappearing from the tokenizer.
      expect([...produced].sort()).toEqual([...Object.values(TokenType)].sort());
    });

    it("classifies a one-line statement as identifier followed by semicolon", () => {
      const tokens = body("move;");
      expect(typesOf(tokens)).toEqual([TokenType.Identifier, TokenType.Semicolon]);
      expect(valuesOf(tokens)).toEqual(["move", ";"]);
    });

    it("treats semicolons as standalone tokens regardless of spacing or repetition", () => {
      expect(typesOf(body("move;"))).toEqual([TokenType.Identifier, TokenType.Semicolon]);
      expect(typesOf(body("move ;"))).toEqual([TokenType.Identifier, TokenType.Semicolon]);
      expect(typesOf(body("move;;"))).toEqual([
        TokenType.Identifier,
        TokenType.Semicolon,
        TokenType.Semicolon,
      ]);
      // A semicolon glued to the next word must not swallow it.
      expect(valuesOf(body("move;turnleft"))).toEqual(["move", ";", "turnleft"]);
    });
  });

  describe("keyword recognition", () => {
    it("recognizes structural keywords regardless of case while preserving the written spelling", () => {
      const spellings = ["BEGINNING-OF-PROGRAM", "beginning-of-program", "Beginning-Of-Program"];

      for (const spelling of spellings) {
        const [token] = body(spelling);
        expect(token.type).toBe(TokenType.BeginningOfProgram);
        // The lexer normalizes only for classification; `value` is the source text.
        expect(token.value).toBe(spelling);
      }
    });

    it("recognizes every control-flow and definition keyword case-insensitively", () => {
      const keywords: Array<[string, TokenType]> = [
        ["end-of-program", TokenType.EndOfProgram],
        ["beginning-of-execution", TokenType.BeginningOfExecution],
        ["end-of-execution", TokenType.EndOfExecution],
        ["begin", TokenType.Begin],
        ["end", TokenType.End],
        ["if", TokenType.If],
        ["then", TokenType.Then],
        ["else", TokenType.Else],
        ["while", TokenType.While],
        ["do", TokenType.Do],
        ["iterate", TokenType.Iterate],
        ["times", TokenType.Times],
        ["define-new-instruction", TokenType.DefineNewInstruction],
        ["as", TokenType.As],
      ];

      for (const [lower, expected] of keywords) {
        expect(typesOf(body(lower))).toEqual([expected]);
        expect(typesOf(body(lower.toUpperCase()))).toEqual([expected]);
        const titleCase = lower.replace(
          /(^|-)([a-z])/g,
          (_, sep, letter) => sep + letter.toUpperCase()
        );
        expect(typesOf(body(titleCase))).toEqual([expected]);
      }
    });
  });

  describe("comments", () => {
    it("ignores everything after // without disturbing line numbering", () => {
      const source = [
        "BEGINNING-OF-PROGRAM // trailing comment",
        "// a whole line of commentary",
        "",
        "BEGINNING-OF-EXECUTION",
      ].join("\n");

      const tokens = body(source);
      expect(typesOf(tokens)).toEqual([
        TokenType.BeginningOfProgram,
        TokenType.BeginningOfExecution,
      ]);
      // The two skipped lines must still count: the second token lives on line 4.
      expect(tokens[0].line).toBe(1);
      expect(tokens[1].line).toBe(4);
    });

    it("cuts the comment even when it is glued to the preceding word or opens the line", () => {
      expect(valuesOf(body("move//no space before the comment"))).toEqual(["move"]);
      expect(body("   // indented comment only")).toEqual([]);
      // Only the first `//` matters; a second one is already inside the comment.
      expect(valuesOf(body("turnleft; // see // below"))).toEqual(["turnleft", ";"]);
    });
  });

  describe("hyphenated words", () => {
    it("keeps a hyphenated condition as a single token instead of splitting on the dashes", () => {
      const tokens = body("front-is-clear");
      expect(tokens).toHaveLength(1);
      expect(tokens[0]).toMatchObject({ type: TokenType.Condition, value: "front-is-clear" });
    });

    it("keeps hyphenated custom instruction names as a single identifier", () => {
      // `turnleft` is a built-in written as one word; `move-to-wall` is a user
      // name with dashes. Both are one identifier token to the lexer, which does
      // not know about BUILT_IN_INSTRUCTIONS.
      expect(body("turnleft")).toEqual([
        { type: TokenType.Identifier, value: "turnleft", line: 1, column: 0 },
      ]);
      expect(body("move-to-wall")).toEqual([
        { type: TokenType.Identifier, value: "move-to-wall", line: 1, column: 0 },
      ]);
      expect(valuesOf(body("move-to-wall; turn-around;"))).toEqual([
        "move-to-wall",
        ";",
        "turn-around",
        ";",
      ]);
    });
  });

  describe("conditions", () => {
    it("recognizes all 18 classic conditions, in any case", () => {
      expect(VALID_CONDITIONS.size).toBe(18);

      for (const condition of VALID_CONDITIONS) {
        for (const spelling of [condition, condition.toUpperCase()]) {
          const tokens = body(spelling);
          expect(tokens, `${spelling} should be a single Condition token`).toHaveLength(1);
          expect(tokens[0].type, spelling).toBe(TokenType.Condition);
          expect(tokens[0].value).toBe(spelling);
        }
      }
    });

    it("does not mistake a near-miss name for a condition", () => {
      // Only exact members of VALID_CONDITIONS are conditions; anything else
      // falls through to Identifier so the parser can report an unknown name.
      expect(typesOf(body("front-is-clearish"))).toEqual([TokenType.Identifier]);
      expect(typesOf(body("front_is_clear"))).toEqual([TokenType.Identifier]);
    });
  });

  describe("numbers", () => {
    it("tokenizes the repeat count of ITERATE n TIMES as a number", () => {
      const tokens = body("ITERATE 12 TIMES");
      expect(typesOf(tokens)).toEqual([TokenType.Iterate, TokenType.Number, TokenType.Times]);
      // The value stays a string; the parser is what turns it into a count.
      expect(tokens[1].value).toBe("12");
    });

    it("accepts only runs of digits as numbers", () => {
      for (const digits of ["0", "3", "42", "007"]) {
        expect(typesOf(body(digits)), digits).toEqual([TokenType.Number]);
      }
      // No sign or decimal support: these are identifiers, not malformed numbers.
      for (const notANumber of ["3x", "x3", "-1", "1.5"]) {
        expect(typesOf(body(notANumber)), notANumber).toEqual([TokenType.Identifier]);
      }
    });
  });

  describe("positions", () => {
    it("reports 1-based lines and 0-based columns", () => {
      const source = [
        "BEGINNING-OF-PROGRAM", // line 1
        "BEGINNING-OF-EXECUTION", // line 2
        "    move;", // line 3: `move` starts at index 4, `;` at index 8
        "END-OF-EXECUTION",
        "END-OF-PROGRAM",
      ].join("\n");

      const tokens = body(source);
      const move = tokens.find((token) => token.value === "move")!;
      const semicolon = tokens.find((token) => token.type === TokenType.Semicolon)!;

      expect(move).toMatchObject({ line: 3, column: 4 });
      expect(semicolon).toMatchObject({ line: 3, column: 8 });
      expect(tokens[0]).toMatchObject({ line: 1, column: 0 });
    });

    it("counts a tab as a single column and survives CRLF line endings", () => {
      // Columns are raw character indices, so a tab advances one column, not four.
      expect(body("\t\tmove")[0]).toMatchObject({ line: 1, column: 2 });

      const crlf = body("BEGIN\r\n\tmove\r\nEND");
      expect(typesOf(crlf)).toEqual([TokenType.Begin, TokenType.Identifier, TokenType.End]);
      // The stray \r is whitespace, so it never leaks into a token value.
      expect(valuesOf(crlf)).toEqual(["BEGIN", "move", "END"]);
      expect(crlf[1]).toMatchObject({ line: 2, column: 1 });
    });
  });

  describe("end of input", () => {
    it("always terminates the stream with exactly one EOF token", () => {
      for (const source of ["", "   ", "// just a comment", FULL_PROGRAM]) {
        const tokens = lex(source);
        expect(tokens.filter((token) => token.type === TokenType.EOF)).toHaveLength(1);
        expect(tokens[tokens.length - 1].type).toBe(TokenType.EOF);
      }
    });

    it("places EOF on the last line of the source with an empty value", () => {
      expect(lex("")).toEqual([{ type: TokenType.EOF, value: "", line: 1, column: 0 }]);

      // A trailing newline creates a final empty line, and EOF is reported there.
      const trailing = lex("move\n\n");
      expect(trailing[trailing.length - 1]).toMatchObject({ line: 3, column: 0 });
    });
  });

  describe("the shipped example program", () => {
    it("tokenizes examples/demo-program.kli into a well-formed stream", () => {
      const tokens = lex(DEMO_PROGRAM_SOURCE);

      expect(tokens[0]).toMatchObject({
        type: TokenType.BeginningOfProgram,
        line: 1,
        column: 0,
      });
      expect(tokens[tokens.length - 1].type).toBe(TokenType.EOF);
      expect(tokens[tokens.length - 2].type).toBe(TokenType.EndOfProgram);

      // Whitespace and `;` are the only separators, so no word token may contain
      // them; a leak here means the word scanner over-consumed. Semicolon tokens
      // are excluded because `;` is their whole value.
      const words = tokens.filter(
        (token) => token.type !== TokenType.Semicolon && token.type !== TokenType.EOF
      );
      expect(words.length).toBeGreaterThan(0);
      for (const token of words) {
        expect(token.value, token.value).not.toMatch(/[\s;]/);
      }

      // The hyphenated custom name is defined once and never called; the
      // one-word one is defined once and called twice.
      expect(tokens.filter((token) => token.value === "move-to-wall")).toHaveLength(1);
      expect(tokens.filter((token) => token.value === "turnright")).toHaveLength(3);
      expect(tokens.filter((token) => token.type === TokenType.DefineNewInstruction)).toHaveLength(
        2
      );
    });
  });
});

describe("whitespace the tokenizer must not choke on", () => {
  // Regression: the outer skip loop handled only space, tab and CR while the
  // inner word loop stopped at every \s. Anything in that gap advanced the
  // index by nothing and appended an empty token until the process ran out of
  // memory — a non-breaking space pasted from a Word or PDF assignment sheet
  // was enough to hang the editor on a student's first keystroke.
  const separators: Array<[string, string]> = [
    ["non-breaking space", "\u00A0"],
    ["vertical tab", "\u000B"],
    ["form feed", "\u000C"],
    ["byte order mark", "\uFEFF"],
    ["line separator", "\u2028"],
    ["paragraph separator", "\u2029"],
    ["em space", "\u2003"],
  ];

  it.each(separators)("treats a %s as a separator", (_name, separator) => {
    const tokens = new Lexer(`move${separator}turnoff`).tokenize();

    expect(valuesOf(tokens.filter((t) => t.type !== TokenType.EOF))).toEqual(["move", "turnoff"]);
  });

  it("never emits an empty token", () => {
    const source = separators.map(([, sep]) => `move${sep}turnoff`).join("\n");

    const tokens = new Lexer(source).tokenize();

    expect(tokens.filter((t) => t.type !== TokenType.EOF).every((t) => t.value.length > 0)).toBe(
      true
    );
  });
});
