/**
 * Token types and definitions for the Karel lexer.
 */

export enum TokenType {
  // Program structure
  BeginningOfProgram = "BEGINNING-OF-PROGRAM",
  EndOfProgram = "END-OF-PROGRAM",
  BeginningOfExecution = "BEGINNING-OF-EXECUTION",
  EndOfExecution = "END-OF-EXECUTION",
  Begin = "BEGIN",
  End = "END",

  // Control flow
  If = "IF",
  Then = "THEN",
  Else = "ELSE",
  While = "WHILE",
  Do = "DO",
  Iterate = "ITERATE",
  Times = "TIMES",

  // Definitions
  DefineNewInstruction = "DEFINE-NEW-INSTRUCTION",
  As = "AS",

  // Other
  Condition = "CONDITION",
  Number = "NUMBER",
  Identifier = "IDENTIFIER",
  Semicolon = "SEMICOLON",
  EOF = "EOF",
}

/**
 * Represents a parsed token.
 * `line` is 1-based; `column` is the 0-based character index within the line.
 */
export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
}
