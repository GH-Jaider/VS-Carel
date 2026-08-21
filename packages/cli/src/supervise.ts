/**
 * Wall-clock enforcement for --timeout.
 *
 * A timer on this thread cannot help: every phase of a run — reading,
 * tokenizing, parsing, executing — is synchronous, so a loop in any of them
 * blocks the event loop and the timer never fires. The only bound that holds
 * against code that refuses to yield is a separate process this one can kill.
 *
 * So when --timeout is given, the CLI re-runs itself as a child and watches
 * the clock from the parent. The child does the real work and knows nothing
 * about any of this beyond an environment variable that stops it recursing.
 *
 * The measured worst case for execution is well under a tenth of a second,
 * bounded by the interpreter's own step and spin budgets. This exists for the
 * phases those budgets do not cover, and therefore for the next bug rather
 * than any known one — a tokenizer that hung on a non-breaking space is how
 * that stopped being hypothetical.
 */

import { spawnSync } from "node:child_process";
import { Exit, type ExitCode } from "./exit.js";

const CHILD_MARKER = "KAREL_SUPERVISED";

/** True when this process is the child, and should just get on with the work. */
export function isSupervisedChild(): boolean {
  return process.env[CHILD_MARKER] === "1";
}

/**
 * Run this same command again under a wall-clock limit, returning the child's
 * exit code — or TIMEOUT if it had to be killed.
 *
 * @param timeoutMs Whole milliseconds; spawnSync rejects anything else.
 * @param label     What the user typed, so the message quotes them back.
 */
export function superviseSelf(timeoutMs: number, label: string): ExitCode {
  const result = spawnSync(process.execPath, [process.argv[1], ...process.argv.slice(2)], {
    stdio: "inherit",
    timeout: timeoutMs,
    env: { ...process.env, [CHILD_MARKER]: "1" },
    // SIGKILL rather than SIGTERM: the case being defended against is a
    // process too busy to run a signal handler.
    killSignal: "SIGKILL",
  });

  if (result.error && (result.error as NodeJS.ErrnoException).code === "ETIMEDOUT") {
    process.stderr.write(`karel: gave up after ${label} seconds\n`);
    return Exit.TIMEOUT;
  }
  if (result.error) {
    process.stderr.write(`karel: could not run: ${result.error.message}\n`);
    return Exit.USAGE;
  }
  // Killed by a signal with no error attached: still a failure to finish.
  if (result.signal) {
    process.stderr.write(`karel: stopped by ${result.signal}\n`);
    return Exit.TIMEOUT;
  }
  return (result.status ?? Exit.TIMEOUT) as ExitCode;
}
