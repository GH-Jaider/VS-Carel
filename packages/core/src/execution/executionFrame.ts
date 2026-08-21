/**
 * Execution frame types for stack-based execution.
 */

import { ASTNode, BlockNode } from "../types/ast";

/**
 * A frame on the execution stack. Discriminated by `type`:
 * - block: a statement list being executed sequentially
 * - while: re-evaluates its condition each pass and pushes the body while true
 * - iterate: pushes the body `remaining` more times
 *
 * The while frame carries its source `line` because it outlives the WhileNode
 * that pushed it: a condition that fails on a later pass still has to report
 * the line the loop was written on.
 */
export type ExecutionFrame =
  | { type: "block"; statements: ASTNode[]; index: number }
  | { type: "while"; condition: string; body: BlockNode; line: number }
  | { type: "iterate"; remaining: number; body: BlockNode };
