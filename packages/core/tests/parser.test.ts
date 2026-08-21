import { describe, expect, it } from "vitest";

import { Parser } from "../src/index";
import type {
  BlockNode,
  DefineInstructionNode,
  Diagnostic,
  IfNode,
  InstructionCallNode,
  IterateNode,
  WhileNode,
} from "../src/index";
// ErrorMessages is deliberately not part of the public barrel: hosts branch on
// Diagnostic.severity, never on prose. Asserting against it here checks *which*
// message the parser chose without freezing the English wording.
import { ErrorMessages } from "../src/messages";
import { DEMO_PROGRAM_SOURCE, program } from "./helpers";

const parse = (source: string) => new Parser().parse(source);

const errorsOf = (diagnostics: Diagnostic[]) => diagnostics.filter((d) => d.severity === "error");

/** First execution statement, typed as whatever the test expects it to be. */
const firstStatement = <T>(source: string): T => {
  const { ast, diagnostics } = parse(source);
  expect(errorsOf(diagnostics)).toEqual([]);
  return ast!.execution.statements[0] as T;
};

describe("Parser", () => {
  describe("a well-formed program", () => {
    it("parses the minimal legal program with no diagnostics at all", () => {
      const { ast, diagnostics } = parse(program("  turnoff;"));

      expect(diagnostics).toEqual([]);
      expect(ast).not.toBeNull();
      expect(ast!.type).toBe("program");
      expect(ast!.definitions).toEqual([]);
      expect(ast!.execution.statements).toEqual([{ type: "call", name: "turnoff", line: 3 }]);
    });

    it("parses the demo program shipped in examples/ without complaining", () => {
      const { ast, diagnostics } = parse(DEMO_PROGRAM_SOURCE);

      expect(diagnostics).toEqual([]);
      expect(ast!.definitions.map((d) => d.name)).toEqual(["turnright", "move-to-wall"]);
    });

    it("reports nothing when the final instruction has no semicolon before a closing keyword", () => {
      // Classic Karel lets the last statement of a block drop its separator.
      const { diagnostics } = parse(program("  move;\n  turnoff"));

      expect(diagnostics).toEqual([]);
    });
  });

  describe("control structures", () => {
    it("builds an if node without an else branch for IF/THEN", () => {
      const node = firstStatement<IfNode>(
        program("  IF front-is-clear THEN\n  BEGIN\n    move;\n  END\n  turnoff;")
      );

      expect(node.type).toBe("if");
      expect(node.condition).toBe("front-is-clear");
      expect(node.thenBranch.statements).toHaveLength(1);
      expect(node.elseBranch).toBeUndefined();
      expect(node.line).toBe(3);
    });

    it("builds an if node with both branches for IF/THEN/ELSE", () => {
      const node = firstStatement<IfNode>(
        program(
          "  IF next-to-a-beeper THEN\n  BEGIN\n    pickbeeper;\n  END\n  ELSE\n  BEGIN\n    putbeeper;\n  END\n  turnoff;"
        )
      );

      expect((node.thenBranch.statements[0] as InstructionCallNode).name).toBe("pickbeeper");
      expect((node.elseBranch!.statements[0] as InstructionCallNode).name).toBe("putbeeper");
    });

    it("builds a while node carrying its condition and body for WHILE/DO", () => {
      const node = firstStatement<WhileNode>(
        program("  WHILE front-is-clear DO\n  BEGIN\n    move;\n  END\n  turnoff;")
      );

      expect(node.type).toBe("while");
      expect(node.condition).toBe("front-is-clear");
      expect((node.body.statements[0] as InstructionCallNode).name).toBe("move");
    });

    it("builds an iterate node with a numeric count for ITERATE n TIMES", () => {
      const node = firstStatement<IterateNode>(
        program("  ITERATE 3 TIMES\n  BEGIN\n    move;\n  END\n  turnoff;")
      );

      expect(node.type).toBe("iterate");
      expect(node.count).toBe(3);
      expect(node.body.statements).toHaveLength(1);
    });

    it("collects DEFINE-NEW-INSTRUCTION bodies into the definitions list, keeping the written casing", () => {
      const { ast, diagnostics } = parse(
        [
          "BEGINNING-OF-PROGRAM",
          "DEFINE-NEW-INSTRUCTION turnRight AS",
          "BEGIN",
          "  turnleft;",
          "  turnleft;",
          "  turnleft;",
          "END",
          "BEGINNING-OF-EXECUTION",
          "  turnRight;",
          "  turnoff;",
          "END-OF-EXECUTION",
          "END-OF-PROGRAM",
        ].join("\n")
      );

      expect(diagnostics).toEqual([]);
      const definition = ast!.definitions[0] as DefineInstructionNode;
      expect(definition.type).toBe("define");
      expect(definition.name).toBe("turnRight");
      expect(definition.line).toBe(2);
      expect(definition.body.statements).toHaveLength(3);
    });

    it("accepts a single statement as a body wherever a BEGIN...END block is legal", () => {
      const blockBody = firstStatement<IfNode>(
        program("  IF front-is-clear THEN\n  BEGIN\n    move;\n  END\n  turnoff;")
      );
      const singleBody = firstStatement<IfNode>(
        program("  IF front-is-clear THEN\n    move;\n  turnoff;")
      );

      // Both spellings must collapse to the same block node; only the line differs.
      expect(singleBody.thenBranch).toEqual<BlockNode>({
        type: "block",
        statements: [{ type: "call", name: "move", line: 4 }],
      });
      expect(blockBody.thenBranch.statements).toHaveLength(1);
    });

    it("tolerates a Pascal-style semicolon right after END", () => {
      const { diagnostics } = parse(
        program("  IF front-is-clear THEN\n  BEGIN\n    move;\n  END;\n  turnoff;")
      );

      expect(diagnostics).toEqual([]);
    });
  });

  describe("instruction resolution", () => {
    it("lets instructions call each other in any order, recursion included", () => {
      // Names are collected in a pre-pass, so a forward reference and a mutually
      // recursive pair are both fine here; bounding the recursion is the interpreter's job.
      const { ast, diagnostics } = parse(
        [
          "BEGINNING-OF-PROGRAM",
          "DEFINE-NEW-INSTRUCTION ping AS",
          "BEGIN",
          "  pong;",
          "END",
          "DEFINE-NEW-INSTRUCTION pong AS",
          "BEGIN",
          "  ping;",
          "END",
          "BEGINNING-OF-EXECUTION",
          "  ping;",
          "  turnoff;",
          "END-OF-EXECUTION",
          "END-OF-PROGRAM",
        ].join("\n")
      );

      expect(diagnostics).toEqual([]);
      expect(ast!.definitions.map((d) => d.name)).toEqual(["ping", "pong"]);
    });

    it("flags a call to an instruction that was never defined", () => {
      const { diagnostics } = parse(program("  jump;\n  turnoff;"));

      expect(diagnostics).toEqual([
        expect.objectContaining({
          message: ErrorMessages.unknownInstruction("jump"),
          severity: "error",
          line: 3,
        }),
      ]);
    });

    it("rejects redefining a built-in but only warns when a custom name is defined twice", () => {
      const { ast, diagnostics } = parse(
        [
          "BEGINNING-OF-PROGRAM",
          "DEFINE-NEW-INSTRUCTION move AS",
          "  turnleft;",
          "DEFINE-NEW-INSTRUCTION spin AS",
          "  turnleft;",
          "DEFINE-NEW-INSTRUCTION spin AS",
          "  turnleft;",
          "BEGINNING-OF-EXECUTION",
          "  spin;",
          "  turnoff;",
          "END-OF-EXECUTION",
          "END-OF-PROGRAM",
        ].join("\n")
      );

      expect(diagnostics).toEqual([
        expect.objectContaining({
          message: ErrorMessages.cannotRedefineBuiltIn("move"),
          severity: "error",
          line: 2,
        }),
        expect.objectContaining({
          message: ErrorMessages.duplicateInstruction("spin"),
          severity: "warning",
          line: 6,
        }),
      ]);
      // Both definitions survive in the AST; the interpreter decides which one wins.
      expect(ast!.definitions.map((d) => d.name)).toEqual(["move", "spin", "spin"]);
    });
  });

  describe("missing turnoff", () => {
    it("warns rather than errors when the program never calls turnoff", () => {
      const { ast, diagnostics } = parse(program("  move;"));

      expect(errorsOf(diagnostics)).toEqual([]);
      expect(diagnostics).toEqual([
        expect.objectContaining({
          message: ErrorMessages.missingTurnoff(),
          severity: "warning",
        }),
      ]);
      expect(ast).not.toBeNull(); // a best-effort AST is still returned
    });

    it("stays quiet when turnoff only appears inside a defined instruction", () => {
      const { diagnostics } = parse(
        [
          "BEGINNING-OF-PROGRAM",
          "DEFINE-NEW-INSTRUCTION finish AS",
          "BEGIN",
          "  turnoff;",
          "END",
          "BEGINNING-OF-EXECUTION",
          "  move;",
          "END-OF-EXECUTION",
          "END-OF-PROGRAM",
        ].join("\n")
      );

      expect(diagnostics).toEqual([]);
    });
  });

  describe("error recovery", () => {
    const brokenProgram = [
      "BEGINNING-OF-PROGRAM",
      "BEGINNING-OF-EXECUTION",
      "  move",
      "  IF front-is-clear",
      "    move;",
      "  WHILE next-to-a-beeper",
      "    pickbeeper;",
      "  jump;",
      "  ITERATE TIMES",
      "    move;",
      "  turnoff;",
      "END-OF-EXECUTION",
      "END-OF-PROGRAM",
    ].join("\n");

    it("keeps parsing after a mistake and reports every error in the file, not just the first", () => {
      const { ast, diagnostics } = parse(brokenProgram);

      expect(diagnostics.map((d) => ({ line: d.line, message: d.message }))).toEqual([
        { line: 3, message: ErrorMessages.missingSemicolon() },
        { line: 5, message: ErrorMessages.expectedKeyword("THEN", "move") },
        { line: 7, message: ErrorMessages.expectedKeyword("DO", "pickbeeper") },
        { line: 8, message: ErrorMessages.unknownInstruction("jump") },
        { line: 9, message: ErrorMessages.invalidIterateCount() },
      ]);

      // Recovery is not just diagnostic noise: the whole program still lands in the AST.
      expect(ast!.execution.statements.map((s) => s.type)).toEqual([
        "call",
        "if",
        "while",
        "call",
        "iterate",
        "call",
      ]);
      expect((ast!.execution.statements[4] as IterateNode).count).toBe(0);
    });

    it("gives every diagnostic a position that points inside the document", () => {
      const lines = brokenProgram.split("\n");
      const { diagnostics } = parse(brokenProgram);

      expect(diagnostics.length).toBeGreaterThan(1);
      for (const diagnostic of diagnostics) {
        expect(diagnostic.line).toBeGreaterThanOrEqual(1);
        expect(diagnostic.line).toBeLessThanOrEqual(lines.length);
        expect(diagnostic.column).toBeGreaterThanOrEqual(0);
        expect(diagnostic.endColumn!).toBeGreaterThan(diagnostic.column);
      }
    });

    it("spans exactly the offending word so an editor can underline it", () => {
      const source = program("  IF front-is-clea THEN\n    move;\n  turnoff;");
      const { diagnostics } = parse(source);

      const [misspelled] = diagnostics;
      expect(misspelled.message).toBe(ErrorMessages.unknownCondition("front-is-clea"));
      const line = source.split("\n")[misspelled.line - 1];
      expect(line.slice(misspelled.column, misspelled.endColumn)).toBe("front-is-clea");
    });

    it("reports each missing structural keyword separately", () => {
      const { ast, diagnostics } = parse("BEGINNING-OF-EXECUTION\n  turnoff;\n");

      expect(diagnostics.map((d) => d.message)).toEqual([
        ErrorMessages.missingProgramStart(),
        ErrorMessages.missingExecutionEnd(),
        ErrorMessages.missingProgramEnd(),
      ]);
      expect(ast!.execution.statements).toHaveLength(1);
    });

    it("drops a stray semicolon or a misplaced keyword and keeps the statements around it", () => {
      const straySemicolon = parse(program("  move;\n  ;\n  turnoff;"));
      expect(straySemicolon.diagnostics).toEqual([
        expect.objectContaining({ message: ErrorMessages.unexpectedSemicolon(), line: 4 }),
      ]);

      const strayKeyword = parse(program("  move;\n  ELSE\n  turnoff;"));
      expect(strayKeyword.diagnostics).toEqual([
        expect.objectContaining({ message: ErrorMessages.unexpectedToken("ELSE"), line: 4 }),
      ]);

      // Neither noise token may take a neighbouring statement down with it.
      for (const { ast } of [straySemicolon, strayKeyword]) {
        expect(ast!.execution.statements).toEqual([
          { type: "call", name: "move", line: 3 },
          { type: "call", name: "turnoff", line: 5 },
        ]);
      }
    });

    it("recovers from a DEFINE-NEW-INSTRUCTION that never says what it defines", () => {
      // This is the only path that calls synchronize(); the point of the test is
      // that it makes progress and still hands back an AST instead of hanging or
      // swallowing the rest of the file.
      const { ast, diagnostics } = parse(
        [
          "BEGINNING-OF-PROGRAM",
          "DEFINE-NEW-INSTRUCTION AS",
          "BEGIN",
          "  turnleft;",
          "END",
          "BEGINNING-OF-EXECUTION",
          "  turnoff;",
          "END-OF-EXECUTION",
          "END-OF-PROGRAM",
        ].join("\n")
      );

      expect(diagnostics[0]).toEqual(
        expect.objectContaining({
          message: ErrorMessages.expectedInstructionName(),
          severity: "error",
          line: 2,
        })
      );
      expect(ast!.definitions).toEqual([]);
      // The nameless body is re-read as an ordinary block, so turnoff survives.
      expect(ast!.execution.statements.at(-1)).toEqual({ type: "call", name: "turnoff", line: 7 });
    });

    it("only warns about content trailing after END-OF-PROGRAM", () => {
      const { diagnostics } = parse(program("  turnoff;") + "\nmove;");

      expect(diagnostics).toEqual([
        expect.objectContaining({
          message: ErrorMessages.contentAfterProgramEnd(),
          severity: "warning",
          line: 6,
        }),
      ]);
    });

    it("returns no AST at all for an empty source", () => {
      const { ast, diagnostics } = parse("");

      expect(ast).toBeNull();
      expect(diagnostics).toEqual([
        expect.objectContaining({ message: ErrorMessages.emptyProgram(), severity: "error" }),
      ]);
    });
  });
});
