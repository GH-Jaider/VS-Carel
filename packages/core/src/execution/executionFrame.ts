/**
 * Execution frame types for stack-based execution.
 */

import { ASTNode, BlockNode } from "../types/ast";

/**
 * A frame on the execution stack. Discriminated by `type`:
 * - block: a statement list being executed sequentially
 * - while: re-evaluates its condition each pass and pushes the body while true
 * - iterate: pushes the body `remaining` more times
 */
export type ExecutionFrame =
  | { type: "block"; statements: ASTNode[]; index: number }
  | { type: "while"; condition: string; body: BlockNode }
  | { type: "iterate"; remaining: number; body: BlockNode };
