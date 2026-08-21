/**
 * Interpreter for executing Karel programs.
 *
 * Both run() (animated, with a delay between steps) and step() (one visible
 * step per call) drive the same explicit execution stack. A "visible step"
 * is one executed instruction call; control-flow bookkeeping (entering
 * blocks, evaluating conditions, expanding custom instructions) happens
 * silently within the same step.
 *
 * onStep fires AFTER the instruction has executed, so the world the UI
 * renders is always in sync with the highlighted line.
 */

import { World } from "../world";
import { ProgramNode, BlockNode, InstructionCallNode } from "../types/ast";
import { RuntimeError, Diagnostic } from "../types/errors";
import { ErrorMessages } from "../messages";
import { Parser } from "../parsing/parser";
import { ExecutionFrame } from "./executionFrame";

const DEFAULT_MAX_STEPS = 100_000;
const MAX_STACK_DEPTH = 2_000;
// Bookkeeping budget within one visible step. Must be generous: a legal
// `ITERATE 5000 TIMES <empty-ish body>` spins ~5x its count without any
// visible action. A truly stuck loop (WHILE true DO BEGIN END) burns this
// budget in a few milliseconds and still errors out promptly.
const MAX_INTERNAL_SPINS = 1_000_000;
// Unlike maxSteps, these two are not configurable: they guard the engine
// itself (stack growth, non-terminating bookkeeping) rather than the
// student's step budget, so raising them only trades an error for a hang.

const MIN_SPEED_MS = 10;
const MAX_SPEED_MS = 5_000;

type CallResult = "action" | "expanded" | "off";

export class Interpreter {
  private readonly world: World;
  private ast: ProgramNode | null = null;
  private customInstructions = new Map<string, BlockNode>();

  private stack: ExecutionFrame[] = [];
  private started = false;
  private finished = false;
  private stopRequested = false;
  private runLoopActive = false;
  private visibleSteps = 0;
  private executionSpeed = 500;
  private readonly maxSteps: number;

  // Callbacks for UI updates
  public onStep?: (line: number) => void;
  public onComplete?: () => void;
  public onError?: (error: RuntimeError) => void;

  /**
   * @param options.maxSteps Visible instructions allowed before the run is
   *   declared an infinite loop. Lower it for batch grading, raise it for a
   *   program that legitimately does a lot of work. A value that is not a
   *   positive finite number falls back to the default rather than disabling
   *   the guard, which is what NaN, 0 or Infinity would silently do.
   */
  constructor(world: World, options?: { maxSteps?: number }) {
    this.world = world;
    const requested = options?.maxSteps;
    this.maxSteps =
      typeof requested === "number" && Number.isFinite(requested) && requested > 0
        ? Math.floor(requested)
        : DEFAULT_MAX_STEPS;
  }

  get isStarted(): boolean {
    return this.started;
  }

  get isFinished(): boolean {
    return this.finished;
  }

  /**
   * Load and parse a program. Returns the parser diagnostics; callers should
   * refuse to execute when any diagnostic has severity "error".
   */
  load(source: string): Diagnostic[] {
    const parser = new Parser();
    const { ast, diagnostics } = parser.parse(source);
    this.ast = ast;

    this.customInstructions.clear();
    if (ast) {
      for (const def of ast.definitions) {
        this.customInstructions.set(def.name.toLowerCase(), def.body);
      }
    }

    return diagnostics;
  }

  /**
   * Run the program with an animation delay between visible steps.
   * Resolves when the program completes, errors, or is stopped.
   */
  async run(): Promise<void> {
    if (this.runLoopActive) {
      return;
    }
    this.ensureInitialized();
    this.stopRequested = false;
    this.runLoopActive = true;
    try {
      while (!this.finished && !this.stopRequested) {
        const hasMore = this.advanceOneStep();
        if (!hasMore) {
          break;
        }
        await this.delay();
      }
    } finally {
      this.runLoopActive = false;
    }
  }

  /**
   * Execute a single visible step. Returns true if there is more to execute.
   */
  step(): boolean {
    if (this.finished) {
      return false;
    }
    this.ensureInitialized();
    this.stopRequested = false;
    return this.advanceOneStep();
  }

  /**
   * Request that a running loop stops after the current step.
   */
  stop(): void {
    this.stopRequested = true;
  }

  /**
   * Set execution speed in milliseconds between steps. Applies live.
   */
  setSpeed(ms: number): void {
    this.executionSpeed = Math.max(MIN_SPEED_MS, Math.min(MAX_SPEED_MS, ms));
  }

  private ensureInitialized(): void {
    if (!this.ast) {
      throw new RuntimeError(ErrorMessages.programNotLoaded(), undefined, "internal");
    }
    if (!this.started) {
      this.stack = [{ type: "block", statements: this.ast.execution.statements, index: 0 }];
      this.started = true;
      this.finished = false;
      this.visibleSteps = 0;
    }
  }

  /**
   * Execute one step, translating the outcome into callbacks.
   */
  private advanceOneStep(): boolean {
    try {
      const hasMore = this.executeOneStep();
      if (!hasMore) {
        this.finished = true;
        this.onComplete?.();
      }
      return hasMore;
    } catch (e) {
      this.finished = true;
      if (e instanceof RuntimeError) {
        this.onError?.(e);
        return false;
      }
      throw e;
    }
  }

  /**
   * Advance until exactly one instruction call has executed.
   * Returns true if there is more program to run afterwards.
   */
  private executeOneStep(): boolean {
    let spins = 0;

    while (this.stack.length > 0) {
      if (++spins > MAX_INTERNAL_SPINS) {
        throw new RuntimeError(ErrorMessages.stuckWithoutProgress(), undefined, "limit");
      }

      const frame = this.stack[this.stack.length - 1];

      if (frame.type === "block") {
        if (frame.index >= frame.statements.length) {
          this.stack.pop();
          continue;
        }

        const statement = frame.statements[frame.index++];

        switch (statement.type) {
          case "call": {
            const call = statement as InstructionCallNode;
            const result = this.executeCall(call);
            if (result === "expanded") {
              // A custom instruction was expanded; keep going until a real
              // instruction executes so expansion doesn't consume a step.
              continue;
            }
            this.visibleSteps++;
            if (this.visibleSteps > this.maxSteps) {
              throw new RuntimeError(
                ErrorMessages.maxIterationsReached(this.maxSteps),
                call.line,
                "limit"
              );
            }
            this.onStep?.(call.line);
            return result !== "off";
          }
          case "if": {
            if (this.evaluateCondition(statement.condition, statement.line)) {
              this.stack.push({
                type: "block",
                statements: statement.thenBranch.statements,
                index: 0,
              });
            } else if (statement.elseBranch) {
              this.stack.push({
                type: "block",
                statements: statement.elseBranch.statements,
                index: 0,
              });
            }
            continue;
          }
          case "while": {
            this.stack.push({
              type: "while",
              condition: statement.condition,
              body: statement.body,
              line: statement.line,
            });
            continue;
          }
          case "iterate": {
            if (statement.count > 0) {
              this.stack.push({
                type: "iterate",
                remaining: statement.count,
                body: statement.body,
              });
            }
            continue;
          }
          case "block": {
            this.stack.push({
              type: "block",
              statements: (statement as BlockNode).statements,
              index: 0,
            });
            continue;
          }
          default:
            continue;
        }
      } else if (frame.type === "while") {
        if (!this.evaluateCondition(frame.condition, frame.line)) {
          this.stack.pop();
          continue;
        }
        this.stack.push({ type: "block", statements: frame.body.statements, index: 0 });
        continue;
      } else {
        // iterate
        if (frame.remaining <= 0) {
          this.stack.pop();
          continue;
        }
        frame.remaining--;
        this.stack.push({ type: "block", statements: frame.body.statements, index: 0 });
        continue;
      }
    }

    return false;
  }

  /**
   * Evaluate a condition, stamping the source line onto any RuntimeError the
   * world raises. The world has no notion of line numbers, so without this an
   * unknown condition inside IF/WHILE would surface with line === undefined —
   * unlike every failure reached through executeCall.
   */
  private evaluateCondition(condition: string, line: number): boolean {
    try {
      return this.world.evaluateCondition(condition);
    } catch (e) {
      if (e instanceof RuntimeError) {
        if (e.line === undefined) {
          e.line = line;
        }
        throw e;
      }
      if (e instanceof Error) {
        throw new RuntimeError(e.message, line);
      }
      throw e;
    }
  }

  /**
   * Execute a single instruction call against the world.
   * Errors are wrapped in RuntimeError carrying the source line.
   */
  private executeCall(node: InstructionCallNode): CallResult {
    const name = node.name.toLowerCase();

    try {
      switch (name) {
        case "move":
          this.world.move();
          return "action";
        case "turnleft":
          this.world.turnLeft();
          return "action";
        case "pickbeeper":
          this.world.pickBeeper();
          return "action";
        case "putbeeper":
          this.world.putBeeper();
          return "action";
        case "turnoff":
          return "off";
        default: {
          const body = this.customInstructions.get(name);
          if (!body) {
            throw new RuntimeError(
              ErrorMessages.unknownInstruction(node.name),
              node.line,
              "unknown-name"
            );
          }
          if (this.stack.length >= MAX_STACK_DEPTH) {
            throw new RuntimeError(ErrorMessages.recursionTooDeep(node.name), node.line, "limit");
          }
          this.stack.push({ type: "block", statements: body.statements, index: 0 });
          return "expanded";
        }
      }
    } catch (e) {
      if (e instanceof RuntimeError) {
        if (e.line === undefined) {
          e.line = node.line;
        }
        throw e;
      }
      if (e instanceof Error) {
        throw new RuntimeError(e.message, node.line);
      }
      throw e;
    }
  }

  private delay(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, this.executionSpeed));
  }
}
