/**
 * Rendering. Two audiences: a person watching a terminal, and a script that
 * asked for --json. Human output goes to stderr when it describes a failure,
 * so `karel run prog.kli --world w.klm --json > result.json` still shows the
 * reason on screen while the JSON stays clean on stdout.
 */

import type { Diagnostic } from "@karel/core";
import type { CheckResult, ParseFailure, Result, RunResult } from "./commands.js";

export function renderJson(result: Result): string {
  switch (result.command) {
    case "check":
      return stringify({
        status: hasErrors(result.diagnostics) ? "parse-error" : "ok",
        diagnostics: result.diagnostics,
      });
    case "parse-failed":
      return stringify({ status: "parse-error", diagnostics: result.diagnostics });
    case "run":
      return stringify({
        status: result.failure ? "error" : "ok",
        ...(result.failure ? { kind: result.failure.kind } : {}),
        ...(result.failure?.line !== undefined ? { line: result.failure.line } : {}),
        ...(result.failure ? { message: result.failure.message } : {}),
        steps: result.steps,
        world: result.world,
        diagnostics: result.diagnostics,
      });
  }
}

/** Human-readable lines, paired with the stream each belongs on. */
export function renderText(
  result: Result,
  programName: string
): Array<[NodeJS.WriteStream, string]> {
  const out: Array<[NodeJS.WriteStream, string]> = [];
  const warn = (d: Diagnostic) => out.push([process.stderr, `  ${formatDiagnostic(d)}`]);

  switch (result.command) {
    case "check":
    case "parse-failed": {
      const errors = result.diagnostics.filter((d) => d.severity === "error");
      if (errors.length === 0) {
        out.push([process.stdout, `${programName}: no errors`]);
      } else {
        out.push([process.stderr, `${programName}: ${count(errors.length, "error")}`]);
        errors.forEach(warn);
      }
      result.diagnostics.filter((d) => d.severity !== "error").forEach(warn);
      return out;
    }
    case "run": {
      result.diagnostics.forEach(warn);
      if (!result.failure) {
        out.push([process.stdout, `${programName}: finished after ${count(result.steps, "step")}`]);
        return out;
      }
      // An assert-world failure is not a crash: the program ran to turnoff and
      // simply left the world in the wrong state. Saying "stopped" would send a
      // student hunting for a shutoff that never happened.
      const verb = result.failure.kind === "assert-world" ? "finished" : "stopped";
      const where = result.failure.line === undefined ? "" : ` on line ${result.failure.line}`;
      out.push([
        process.stderr,
        `${programName}: ${verb} after ${count(result.steps, "step")}${where} — ${result.failure.message}`,
      ]);
      return out;
    }
  }
}

function formatDiagnostic(d: Diagnostic): string {
  // Columns are 0-based inside the parser but every editor and compiler
  // reports them from 1, and this output sits next to that of other tools.
  return `${d.line}:${d.column + 1} ${d.severity}: ${d.message}`;
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function stringify(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function hasErrors(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === "error");
}

export function isRun(result: Result): result is RunResult {
  return result.command === "run";
}

export function isParseFailure(result: Result): result is ParseFailure | CheckResult {
  return result.command === "parse-failed" || result.command === "check";
}
