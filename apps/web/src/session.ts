/**
 * Execution state, and the single place that owns it.
 *
 * Everything else in the app is a projection of what this reports: the canvas
 * draws `view().world`, the editor highlights `view().line`, the transport
 * enables what `view().state` allows. Nothing else may hold a World or an
 * Interpreter, because two owners of execution state is how a stopped program
 * ends up still animating.
 *
 * The state machine and the rules around it are lifted from the VS Code
 * extension's controller, where they were worked out against real use — most
 * of all the `preparing` guard, which exists because a second run started
 * while the first was still being set up used to leave two interpreters
 * driving the same canvas.
 */

import { Interpreter, World, type Diagnostic, type KarelMap } from "@karel/core";
import type { SessionState, SessionView } from "./contracts.js";
import { t } from "./i18n.js";

export const SPEED_PRESETS: { label: string; ms: number }[] = [
  { label: "0.25x", ms: 1000 },
  { label: "0.5x", ms: 500 },
  { label: "1x", ms: 250 },
  { label: "2x", ms: 120 },
  { label: "4x", ms: 50 },
];

export const DEFAULT_SPEED_MS = 250;

export interface SessionOptions {
  /** Called whenever anything a viewer renders has changed. */
  onChange: () => void;
}

export class Session {
  private state: SessionState = "idle";
  private map: KarelMap;
  private world: World;
  private interpreter: Interpreter | null = null;
  private source = "";
  private line: number | null = null;
  private steps = 0;
  private message: string | undefined;
  private speedMs = DEFAULT_SPEED_MS;
  private diagnostics: Diagnostic[] = [];

  /**
   * Set while a run is being prepared. Two starts that overlap would each
   * build an interpreter and both would drive the same world.
   */
  private preparing = false;
  private stopRequested = false;

  constructor(
    map: KarelMap,
    private readonly options: SessionOptions
  ) {
    this.map = map;
    this.world = new World(map);
  }

  view(): SessionView {
    return {
      state: this.state,
      world: this.world.toJSON(),
      line: this.line,
      steps: this.steps,
      ...(this.message === undefined ? {} : { message: this.message }),
    };
  }

  currentDiagnostics(): Diagnostic[] {
    return this.diagnostics;
  }

  speed(): number {
    return this.speedMs;
  }

  /** The starting map. Running never writes to it, so reset is always exact. */
  startingMap(): KarelMap {
    return this.map;
  }

  setSource(source: string): void {
    this.source = source;
    // Parse on every keystroke so the underlines follow the cursor. The whole
    // program is a few hundred tokens; there is nothing here worth debouncing.
    this.diagnostics = new Interpreter(new World(this.map)).load(source);
    this.options.onChange();
  }

  setWorld(map: KarelMap): void {
    this.stop();
    this.map = map;
    this.world = new World(map);
    this.line = null;
    this.steps = 0;
    this.message = undefined;
    this.state = "idle";
    this.options.onChange();
  }

  setSpeed(ms: number): void {
    this.speedMs = ms;
    this.interpreter?.setSpeed(ms);
  }

  /** Blocking errors, the ones that stop a program being run at all. */
  blockingErrors(): Diagnostic[] {
    return this.diagnostics.filter((d) => d.severity === "error");
  }

  async run(): Promise<void> {
    if (this.preparing || this.state === "running") {
      return;
    }
    this.preparing = true;
    try {
      if (!this.prepare()) {
        return;
      }
      this.setState("running");
    } finally {
      this.preparing = false;
    }

    this.stopRequested = false;
    await this.interpreter?.run();
  }

  step(): void {
    if (this.preparing || this.state === "running") {
      return;
    }
    this.preparing = true;
    try {
      if (!this.prepare()) {
        return;
      }
      this.setState("stepping");
    } finally {
      this.preparing = false;
    }

    const more = this.interpreter?.step();
    if (more === false && this.state === "stepping") {
      // step() returning false without onComplete or onError having fired
      // means the program simply ran out of statements.
      this.setState("done");
    }
    this.options.onChange();
  }

  stop(): void {
    if (this.state !== "running" && this.state !== "stepping") {
      return;
    }
    this.stopRequested = true;
    this.interpreter?.stop();
    this.setState("idle");
  }

  /**
   * Back to the starting world. The map is the initial state and execution
   * runs on a copy, so this cannot lose anything the user typed.
   */
  reset(): void {
    this.stop();
    this.interpreter = null;
    this.world = new World(this.map);
    this.line = null;
    this.steps = 0;
    this.message = undefined;
    this.setState("idle");
  }

  /**
   * What the primary button does, given where we are. Only ever run or stop:
   * reset has its own button, and a primary that turned into a third verb
   * would show "reset" twice on a finished program.
   *
   * Running from a finished or failed state resets first, which prepare()
   * already does, so the button never has to say so.
   */
  primaryAction(): "run" | "stop" {
    return this.state === "running" || this.state === "stepping" ? "stop" : "run";
  }

  /**
   * Build an interpreter over a fresh world, unless one is already part-way
   * through. Returns false when the program cannot run.
   */
  private prepare(): boolean {
    if (this.interpreter && (this.state === "stepping" || this.state === "running")) {
      return true;
    }
    if (this.state === "error" || this.state === "done") {
      this.reset();
    }

    if (this.blockingErrors().length > 0) {
      this.message = t("error.fixProgram");
      this.setState("error");
      return false;
    }

    this.world = new World(this.map);
    this.steps = 0;
    this.message = undefined;

    const interpreter = new Interpreter(this.world);
    this.diagnostics = interpreter.load(this.source);
    if (this.blockingErrors().length > 0) {
      this.message = t("error.fixProgram");
      this.setState("error");
      return false;
    }

    interpreter.setSpeed(this.speedMs);
    interpreter.onStep = (line) => {
      this.line = line;
      this.steps++;
      this.options.onChange();
    };
    interpreter.onComplete = () => {
      this.line = null;
      this.setState("done");
    };
    interpreter.onError = (error) => {
      this.line = error.line ?? this.line;
      this.message = error.message;
      this.setState("error");
    };

    this.interpreter = interpreter;
    return true;
  }

  private setState(state: SessionState): void {
    // A stop already moved us to idle; a callback arriving afterwards from the
    // run loop must not drag the UI back into a finished state.
    if (this.stopRequested && (state === "done" || state === "error")) {
      return;
    }
    this.state = state;
    this.options.onChange();
  }
}
