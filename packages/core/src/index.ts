export { Karel, Direction, parseDirection } from "./karel";
export type { Position } from "./karel";

export { World, validateKarelMap, MAX_WORLD_SIZE } from "./world";
export type { KarelMap, MapValidationResult, Wall, BeeperStack, Dimensions } from "./world";

export { Interpreter } from "./execution/interpreter";
export { Parser } from "./parsing/parser";
// The whole node union: Parser.parse() hands back a ProgramNode, so a consumer
// that wants to name or walk that result needs every node type reachable.
export type {
  ASTNode,
  ProgramNode,
  DefineInstructionNode,
  ExecutionBlockNode,
  BlockNode,
  IfNode,
  WhileNode,
  IterateNode,
  InstructionCallNode,
} from "./types/ast";
// Public so a host can syntax-highlight from the same tokenizer the parser
// uses, instead of maintaining a second grammar that drifts from it.
export { Lexer } from "./parsing/lexer";
export { TokenType } from "./types/tokens";
export type { Token } from "./types/tokens";
// The parser never throws: it recovers and reports Diagnostic[]. RuntimeError
// is the only error class the core raises, and the only one worth catching.
export { RuntimeError } from "./types/errors";
export type { RuntimeErrorKind } from "./types/errors";
export type { Diagnostic } from "./types/errors";
export { BUILT_IN_INSTRUCTIONS, VALID_CONDITIONS } from "./parsing/constants";
