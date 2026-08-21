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
 * Runtime error during execution.
 */
export class RuntimeError extends Error {
  constructor(
    message: string,
    public line?: number
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
