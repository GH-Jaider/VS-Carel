#!/usr/bin/env node
/**
 * karel — run and grade Karel programs without an editor.
 *
 * The point of this command is the exit code. A marker with sixty submissions
 * writes a loop over them and reads $?; everything printed is for the human
 * reading the log afterwards.
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { validateKarelMap, type KarelMap } from "@karel/core";
import { check, run, type Result } from "./commands.js";
import { Exit, type ExitCode } from "./exit.js";
import { renderJson, renderText } from "./output.js";

const USAGE = `karel — run and grade Karel programs

Usage:
  karel run <program.kli> --world <world.klm> [options]
  karel check <program.kli> [--json]

Options:
  -w, --world <file>       World the program runs in (required for run)
  -a, --assert-world <file>  Require this final world; mismatch exits 1
  -m, --max-steps <n>      Instruction budget before declaring a loop
      --json               Machine-readable result on stdout
  -h, --help               Show this message
  -v, --version            Show the version

Exit codes:
  0  finished, and matched --assert-world if given
  1  error shutoff, or the final world did not match
  2  the program did not parse
  3  ran past the step budget: almost certainly a loop
  64 bad invocation

Examples:
  karel run maze.kli --world maze.klm
  karel run maze.kli --world start.klm --assert-world solved.klm
  karel check submission.kli --json

  for f in submissions/*.kli; do
    karel run "$f" -w start.klm -a solved.klm >/dev/null 2>&1 \\
      && echo "PASS $f" || echo "FAIL $f ($?)"
  done
`;

// Kept in step with packages/cli/package.json by the release checklist; there
// is no bundler define for it because the CLI ships as one standalone file.
const VERSION = "0.1.0";

function main(argv: string[]): ExitCode {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        world: { type: "string", short: "w" },
        "assert-world": { type: "string", short: "a" },
        "max-steps": { type: "string", short: "m" },
        json: { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
      },
    });
  } catch (error) {
    return usageError(error instanceof Error ? error.message : String(error));
  }

  const { values, positionals } = parsed;

  if (values.help) {
    process.stdout.write(USAGE);
    return Exit.OK;
  }
  if (values.version) {
    process.stdout.write(`${VERSION}\n`);
    return Exit.OK;
  }

  const [command, programPath, ...extra] = positionals;
  if (!command) {
    process.stderr.write(USAGE);
    return Exit.USAGE;
  }
  if (command !== "run" && command !== "check") {
    return usageError(`unknown command '${command}'`);
  }
  if (!programPath) {
    return usageError(`${command} needs a program file`);
  }
  if (extra.length > 0) {
    return usageError(`unexpected argument '${extra[0]}'`);
  }

  const source = readTextFile(programPath);
  if (source instanceof Error) {
    return usageError(source.message);
  }

  const programName = basename(programPath);

  if (command === "check") {
    // Fail closed. Accepting run's flags here and ignoring them means a marker
    // who types `check` where they meant `run` — or who bolts --assert-world
    // onto the check line from --help — gets exit 0 for every submission in
    // the directory, including the empty ones.
    const misplaced = (["world", "assert-world", "max-steps"] as const).find(
      (flag) => values[flag] !== undefined
    );
    if (misplaced) {
      return usageError(`check does not take --${misplaced}; did you mean 'karel run'?`);
    }
    return report(check(source), programName, values.json);
  }

  if (!values.world) {
    return usageError("run needs --world");
  }

  const map = readWorld(values.world);
  if (map instanceof Error) {
    return usageError(map.message);
  }

  let expected: KarelMap | undefined;
  if (values["assert-world"]) {
    const asserted = readWorld(values["assert-world"]);
    if (asserted instanceof Error) {
      return usageError(asserted.message);
    }
    expected = asserted;
  }

  let maxSteps: number | undefined;
  if (values["max-steps"] !== undefined) {
    maxSteps = Number(values["max-steps"]);
    if (!Number.isInteger(maxSteps) || maxSteps <= 0) {
      return usageError(`--max-steps needs a positive whole number, got '${values["max-steps"]}'`);
    }
  }

  return report(run({ source, map, maxSteps, expected }), programName, values.json);
}

function report(result: Result, programName: string, json: boolean): ExitCode {
  if (json) {
    process.stdout.write(`${renderJson(result)}\n`);
    // Keep the human reason on screen even when stdout is redirected to a
    // file, which is exactly what a marker does. Only the stderr half: stdout
    // has to stay parseable.
    for (const [stream, line] of renderText(result, programName)) {
      if (stream === process.stderr) {
        stream.write(`${line}\n`);
      }
    }
  } else {
    for (const [stream, line] of renderText(result, programName)) {
      stream.write(`${line}\n`);
    }
  }
  return exitCodeFor(result);
}

function exitCodeFor(result: Result): ExitCode {
  switch (result.command) {
    case "parse-failed":
      return Exit.PARSE_ERROR;
    case "check":
      return result.diagnostics.some((d) => d.severity === "error") ? Exit.PARSE_ERROR : Exit.OK;
    case "run":
      if (!result.failure) {
        return Exit.OK;
      }
      // A blown budget is its own code: for a marker it means "did not
      // terminate", which needs a different conversation with the student
      // than "walked into a wall".
      return result.failure.kind === "limit" ? Exit.LIMIT : Exit.FAILED;
  }
}

function readTextFile(path: string): string | Error {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    const reason =
      err.code === "ENOENT"
        ? "no such file"
        : err.code === "EISDIR"
          ? "that is a directory"
          : (err.message ?? String(error));
    return new Error(`cannot read '${path}': ${reason}`);
  }
}

function readWorld(path: string): KarelMap | Error {
  const raw = readTextFile(path);
  if (raw instanceof Error) {
    return raw;
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    return new Error(`'${path}' is not valid JSON: ${(error as Error).message}`);
  }

  // The same validator the editor uses, so a world rejected here is rejected
  // there too, with the same wording.
  const validation = validateKarelMap(data);
  if (!validation.ok || !validation.map) {
    return new Error(`'${path}' is not a valid world:\n  ${validation.errors.join("\n  ")}`);
  }
  return validation.map;
}

function usageError(message: string): ExitCode {
  process.stderr.write(`karel: ${message}\n\nRun 'karel --help' for usage.\n`);
  return Exit.USAGE;
}

process.exitCode = main(process.argv.slice(2));
