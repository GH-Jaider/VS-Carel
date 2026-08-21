/**
 * Exit codes are the CLI's real interface: a grading script reads them far
 * more often than it reads the output. They are deliberately distinct so a
 * marker can tell "the program is wrong" from "the program does not compile"
 * from "the submission never terminates" without parsing a single message.
 */
export const Exit = {
  /** The program reached turnoff, and any --assert-world matched. */
  OK: 0,
  /** An error shutoff, or a final world that did not match --assert-world. */
  FAILED: 1,
  /** The program did not parse. Nothing was executed. */
  PARSE_ERROR: 2,
  /** The step budget ran out: almost always an infinite loop. */
  LIMIT: 3,
  /** Bad invocation: unknown flag, missing file, malformed world. */
  USAGE: 64,
} as const;

export type ExitCode = (typeof Exit)[keyof typeof Exit];
