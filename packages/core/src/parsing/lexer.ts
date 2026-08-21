/**
 * Lexer (Tokenizer) for Karel instructions.
 */

import { Token, TokenType } from "../types/tokens";
import { VALID_CONDITIONS } from "./constants";

/**
 * Tokenizer for Karel instructions.
 *
 * Scans line by line, tracking real column positions. `//` comments are
 * allowed anywhere in a line (Karel has no string literals, so everything
 * after `//` is comment). Semicolons are standalone tokens, so `move;`,
 * `move ;` and `move;;` all tokenize cleanly.
 */
export class Lexer {
  private tokens: Token[] = [];

  constructor(private readonly source: string) {}

  tokenize(): Token[] {
    this.tokens = [];
    const lines = this.source.split("\n");
    for (let i = 0; i < lines.length; i++) {
      this.tokenizeLine(lines[i], i + 1); // 1-based line numbers
    }

    this.tokens.push({
      type: TokenType.EOF,
      value: "",
      line: Math.max(1, lines.length),
      column: 0,
    });

    return this.tokens;
  }

  private tokenizeLine(text: string, line: number): void {
    const commentStart = text.indexOf("//");
    const code = commentStart >= 0 ? text.slice(0, commentStart) : text;

    let i = 0;
    while (i < code.length) {
      const ch = code[i];

      if (ch === " " || ch === "\t" || ch === "\r") {
        i++;
        continue;
      }

      if (ch === ";") {
        this.tokens.push({ type: TokenType.Semicolon, value: ";", line, column: i });
        i++;
        continue;
      }

      const start = i;
      while (i < code.length && !/[\s;]/.test(code[i])) {
        i++;
      }
      this.addWord(code.slice(start, i), line, start);
    }
  }

  private addWord(word: string, line: number, column: number): void {
    const upperWord = word.toUpperCase();
    let type: TokenType;

    switch (upperWord) {
      case "BEGINNING-OF-PROGRAM":
        type = TokenType.BeginningOfProgram;
        break;
      case "END-OF-PROGRAM":
        type = TokenType.EndOfProgram;
        break;
      case "BEGINNING-OF-EXECUTION":
        type = TokenType.BeginningOfExecution;
        break;
      case "END-OF-EXECUTION":
        type = TokenType.EndOfExecution;
        break;
      case "BEGIN":
        type = TokenType.Begin;
        break;
      case "END":
        type = TokenType.End;
        break;
      case "IF":
        type = TokenType.If;
        break;
      case "THEN":
        type = TokenType.Then;
        break;
      case "ELSE":
        type = TokenType.Else;
        break;
      case "WHILE":
        type = TokenType.While;
        break;
      case "DO":
        type = TokenType.Do;
        break;
      case "ITERATE":
        type = TokenType.Iterate;
        break;
      case "TIMES":
        type = TokenType.Times;
        break;
      case "DEFINE-NEW-INSTRUCTION":
        type = TokenType.DefineNewInstruction;
        break;
      case "AS":
        type = TokenType.As;
        break;
      default:
        if (/^\d+$/.test(word)) {
          type = TokenType.Number;
        } else if (VALID_CONDITIONS.has(word.toLowerCase())) {
          type = TokenType.Condition;
        } else {
          type = TokenType.Identifier;
        }
    }

    this.tokens.push({ type, value: word, line, column });
  }
}
