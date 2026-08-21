/**
 * Error classes and diagnostic types.
 */

/**
 * Parser error with line information.
 */
export class ParseError extends Error {
  constructor(
    message: string,
    public line: number,
    public column?: number
  ) {
    super(message);
    this.name = "ParseError";
  }
}

/**
 * What kind of runtime failure this is.
 *
 * The first four are error shutoffs — the student's program asked Karel to do
 * something impossible, and the offending line is worth showing. "limit" means
 * a budget ran out, which almost always means an infinite loop or recursion.
 * Consumers map these to exit codes, icons or messages without matching on
 * prose, which would break the moment the wording is translated.
 */
export type RuntimeErrorKind =
  | "blocked"
  | "no-beeper"
  | "empty-bag"
  | "unknown-name"
  | "limit"
  | "internal";

/**
 * Runtime error during execution.
 */
export class RuntimeError extends Error {
  constructor(
    message: string,
    public line?: number,
    public kind: RuntimeErrorKind = "internal"
  ) {
    super(message);
    this.name = "RuntimeError";
  }
}

/**
 * Diagnostic information for errors/warnings.
 */
export interface Diagnostic {
  message: string;
  line: number;
  column: number;
  endColumn?: number;
  severity: "error" | "warning" | "info";
}
