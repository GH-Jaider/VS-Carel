/**
 * Parser for Karel instructions.
 *
 * Recursive-descent with error recovery: instead of aborting on the first
 * problem it records a diagnostic, re-synchronizes at the next statement
 * boundary and keeps going, so students see all their mistakes at once.
 * It always returns a best-effort AST; callers decide whether to execute
 * based on the presence of error-severity diagnostics.
 */

import { Token, TokenType } from "../types/tokens";
import {
  ASTNode,
  ProgramNode,
  DefineInstructionNode,
  BlockNode,
  IfNode,
  WhileNode,
  IterateNode,
  InstructionCallNode,
} from "../types/ast";
import { Diagnostic } from "../types/errors";
import { ErrorMessages } from "../messages";
import { Lexer } from "./lexer";
import { BUILT_IN_INSTRUCTIONS } from "./constants";

const STATEMENT_BOUNDARIES = new Set([
  TokenType.If,
  TokenType.While,
  TokenType.Iterate,
  TokenType.Begin,
  TokenType.End,
  TokenType.Else,
  TokenType.DefineNewInstruction,
  TokenType.BeginningOfExecution,
  TokenType.EndOfExecution,
  TokenType.EndOfProgram,
]);

export class Parser {
  private tokens: Token[] = [];
  private current = 0;
  private diagnostics: Diagnostic[] = [];
  private customInstructions = new Set<string>();

  parse(source: string): { ast: ProgramNode | null; diagnostics: Diagnostic[] } {
    this.tokens = new Lexer(source).tokenize();
    this.current = 0;
    this.diagnostics = [];
    this.customInstructions = new Set();

    if (this.check(TokenType.EOF)) {
      this.report(ErrorMessages.emptyProgram(), this.peek());
      return { ast: null, diagnostics: this.diagnostics };
    }

    this.collectInstructionNames();
    const ast = this.parseProgram();
    return { ast, diagnostics: this.diagnostics };
  }

  /**
   * Pre-pass: register every DEFINE-NEW-INSTRUCTION name up front so calls
   * may reference instructions defined later in the file (forward references)
   * and instructions may call themselves (recursion).
   */
  private collectInstructionNames(): void {
    for (let i = 0; i < this.tokens.length - 1; i++) {
      if (this.tokens[i].type !== TokenType.DefineNewInstruction) {
        continue;
      }
      const nameToken = this.tokens[i + 1];
      if (nameToken.type !== TokenType.Identifier) {
        continue;
      }
      const name = nameToken.value.toLowerCase();
      if (BUILT_IN_INSTRUCTIONS.has(name)) {
        this.report(ErrorMessages.cannotRedefineBuiltIn(nameToken.value), nameToken);
      } else if (this.customInstructions.has(name)) {
        this.report(ErrorMessages.duplicateInstruction(nameToken.value), nameToken, "warning");
      }
      this.customInstructions.add(name);
    }
  }

  private parseProgram(): ProgramNode {
    this.expectStructure(TokenType.BeginningOfProgram, ErrorMessages.missingProgramStart());

    const definitions: DefineInstructionNode[] = [];
    while (this.check(TokenType.DefineNewInstruction)) {
      const def = this.parseDefineInstruction();
      if (def) {
        definitions.push(def);
      }
    }

    this.expectStructure(TokenType.BeginningOfExecution, ErrorMessages.missingExecutionStart());

    const statements = this.parseStatementsUntil([
      TokenType.EndOfExecution,
      TokenType.EndOfProgram,
    ]);

    if (statements.length > 0 && !this.containsTurnoff(statements, definitions)) {
      this.report(ErrorMessages.missingTurnoff(), this.peek(), "warning");
    }

    this.expectStructure(TokenType.EndOfExecution, ErrorMessages.missingExecutionEnd());
    this.expectStructure(TokenType.EndOfProgram, ErrorMessages.missingProgramEnd());

    if (!this.check(TokenType.EOF)) {
      this.report(ErrorMessages.contentAfterProgramEnd(), this.peek(), "warning");
    }

    return {
      type: "program",
      definitions,
      execution: { type: "execution", statements },
    };
  }

  private parseDefineInstruction(): DefineInstructionNode | null {
    const defToken = this.advance(); // DEFINE-NEW-INSTRUCTION

    if (!this.check(TokenType.Identifier)) {
      this.report(ErrorMessages.expectedInstructionName(), this.peek());
      this.synchronize();
      return null;
    }
    const nameToken = this.advance();

    if (this.check(TokenType.As)) {
      this.advance();
    } else {
      this.report(ErrorMessages.expectedKeyword("AS", this.peek().value), this.peek());
    }

    const body = this.parseBody();

    return {
      type: "define",
      name: nameToken.value,
      body,
      line: defToken.line,
    };
  }

  /**
   * A statement list bounded by the given closing tokens (or EOF).
   */
  private parseStatementsUntil(stopTypes: TokenType[]): ASTNode[] {
    const statements: ASTNode[] = [];
    while (!this.checkAny(stopTypes) && !this.check(TokenType.EOF)) {
      const statement = this.parseStatement();
      if (statement) {
        statements.push(statement);
      }
    }
    return statements;
  }

  /**
   * The body of THEN/ELSE/DO/TIMES/AS: either a BEGIN...END block or,
   * as in classic Karel, a single statement.
   */
  private parseBody(): BlockNode {
    if (this.check(TokenType.Begin)) {
      return this.parseBlock();
    }
    if (this.check(TokenType.EOF)) {
      this.report(ErrorMessages.expectedKeyword("BEGIN or an instruction", ""), this.peek());
      return { type: "block", statements: [] };
    }
    const statement = this.parseStatement();
    return { type: "block", statements: statement ? [statement] : [] };
  }

  private parseBlock(): BlockNode {
    this.advance(); // BEGIN (checked by caller)

    const statements = this.parseStatementsUntil([
      TokenType.End,
      TokenType.EndOfExecution,
      TokenType.EndOfProgram,
    ]);

    if (this.check(TokenType.End)) {
      this.advance();
      this.skipOptionalSemicolon(); // Pattis-style `END;` is fine
    } else {
      this.report(ErrorMessages.expectedKeyword("END", this.peek().value), this.peek());
    }

    return { type: "block", statements };
  }

  private parseStatement(): ASTNode | null {
    const token = this.peek();

    switch (token.type) {
      case TokenType.If:
        return this.parseIf();
      case TokenType.While:
        return this.parseWhile();
      case TokenType.Iterate:
        return this.parseIterate();
      case TokenType.Begin:
        return this.parseBlock();
      case TokenType.Identifier:
        return this.parseInstructionCall();
      case TokenType.Semicolon:
        this.advance();
        this.report(ErrorMessages.unexpectedSemicolon(), token);
        return null;
      default:
        // A stray keyword, number or condition where a statement should be.
        this.advance();
        this.report(ErrorMessages.unexpectedToken(token.value), token);
        return null;
    }
  }

  private parseCondition(): string {
    if (this.check(TokenType.Condition)) {
      return this.advance().value;
    }
    const token = this.peek();
    this.report(ErrorMessages.unknownCondition(token.value || "nothing"), token);
    if (token.type === TokenType.Identifier) {
      // Probably a misspelled condition: consume it so parsing continues cleanly.
      this.advance();
      return token.value;
    }
    return "";
  }

  private parseIf(): IfNode {
    const ifToken = this.advance(); // IF

    const condition = this.parseCondition();

    if (this.check(TokenType.Then)) {
      this.advance();
    } else {
      this.report(ErrorMessages.expectedKeyword("THEN", this.peek().value), this.peek());
    }

    const thenBranch = this.parseBody();

    let elseBranch: BlockNode | undefined;
    if (this.check(TokenType.Else)) {
      this.advance();
      elseBranch = this.parseBody();
    }

    return { type: "if", condition, thenBranch, elseBranch, line: ifToken.line };
  }

  private parseWhile(): WhileNode {
    const whileToken = this.advance(); // WHILE

    const condition = this.parseCondition();

    if (this.check(TokenType.Do)) {
      this.advance();
    } else {
      this.report(ErrorMessages.expectedKeyword("DO", this.peek().value), this.peek());
    }

    const body = this.parseBody();

    return { type: "while", condition, body, line: whileToken.line };
  }

  private parseIterate(): IterateNode {
    const iterateToken = this.advance(); // ITERATE

    let count = 0;
    if (this.check(TokenType.Number)) {
      count = parseInt(this.advance().value, 10);
    } else {
      this.report(ErrorMessages.invalidIterateCount(), this.peek());
      if (this.check(TokenType.Identifier)) {
        this.advance(); // consume whatever was written where the number goes
      }
    }

    if (this.check(TokenType.Times)) {
      this.advance();
    } else {
      this.report(ErrorMessages.expectedKeyword("TIMES", this.peek().value), this.peek());
    }

    const body = this.parseBody();

    return { type: "iterate", count, body, line: iterateToken.line };
  }

  private parseInstructionCall(): InstructionCallNode {
    const token = this.advance();
    const lowerName = token.value.toLowerCase();

    if (!BUILT_IN_INSTRUCTIONS.has(lowerName) && !this.customInstructions.has(lowerName)) {
      this.report(ErrorMessages.unknownInstruction(token.value), token);
    }

    if (this.check(TokenType.Semicolon)) {
      this.advance();
    } else if (
      !this.checkAny([
        TokenType.End,
        TokenType.Else,
        TokenType.EndOfExecution,
        TokenType.EndOfProgram,
        TokenType.EOF,
      ])
    ) {
      this.report(ErrorMessages.missingSemicolon(), token);
    }

    return { type: "call", name: token.value, line: token.line };
  }

  /**
   * Expect a structural keyword; report (without consuming anything) if absent.
   */
  private expectStructure(type: TokenType, message: string): void {
    if (this.check(type)) {
      this.advance();
      this.skipOptionalSemicolon();
      return;
    }
    this.report(message, this.peek());
  }

  private skipOptionalSemicolon(): void {
    if (this.check(TokenType.Semicolon)) {
      this.advance();
    }
  }

  /**
   * Skip tokens until a likely statement boundary, guaranteeing progress.
   */
  private synchronize(): void {
    if (!this.isAtEnd()) {
      this.advance();
    }
    while (!this.isAtEnd()) {
      if (this.tokens[this.current - 1].type === TokenType.Semicolon) {
        return;
      }
      if (STATEMENT_BOUNDARIES.has(this.peek().type)) {
        return;
      }
      this.advance();
    }
  }

  private containsTurnoff(statements: ASTNode[], definitions: DefineInstructionNode[]): boolean {
    const visit = (nodes: ASTNode[]): boolean => {
      for (const node of nodes) {
        switch (node.type) {
          case "call":
            if ((node as InstructionCallNode).name.toLowerCase() === "turnoff") {
              return true;
            }
            break;
          case "block":
            if (visit((node as BlockNode).statements)) {
              return true;
            }
            break;
          case "if": {
            const ifNode = node as IfNode;
            if (visit(ifNode.thenBranch.statements)) {
              return true;
            }
            if (ifNode.elseBranch && visit(ifNode.elseBranch.statements)) {
              return true;
            }
            break;
          }
          case "while":
            if (visit((node as WhileNode).body.statements)) {
              return true;
            }
            break;
          case "iterate":
            if (visit((node as IterateNode).body.statements)) {
              return true;
            }
            break;
        }
      }
      return false;
    };

    return visit(statements) || definitions.some((d) => visit(d.body.statements));
  }

  private report(
    message: string,
    token: Token,
    severity: "error" | "warning" | "info" = "error"
  ): void {
    this.diagnostics.push({
      message,
      line: token.line,
      column: token.column,
      endColumn: token.column + Math.max(token.value.length, 1),
      severity,
    });
  }

  // Helper methods
  private peek(): Token {
    return this.tokens[this.current];
  }

  private check(type: TokenType): boolean {
    return this.peek().type === type;
  }

  private checkAny(types: TokenType[]): boolean {
    const current = this.peek().type;
    return types.some((t) => t === current);
  }

  private advance(): Token {
    if (!this.isAtEnd()) {
      this.current++;
    }
    return this.tokens[this.current - 1];
  }

  private isAtEnd(): boolean {
    return this.peek().type === TokenType.EOF;
  }
}
