/**
 * User-facing messages produced by the interpreter core.
 * Kept inside src/interpreter so the core stays free of VS Code dependencies.
 */

export const ErrorMessages = {
  // Runtime (error shutoffs)
  moveBlocked: () => "Karel hit a wall: the front is blocked",
  noBeepersToPickUp: (x: number, y: number) => `There is no beeper to pick up at corner (${x}, ${y})`,
  noBeepersInBag: () => "Karel's beeper bag is empty",
  unknownInstruction: (name: string) => `Unknown instruction '${name}'`,
  unknownCondition: (name: string) => `Unknown condition '${name}'`,
  recursionTooDeep: (name: string) =>
    `Instruction '${name}' calls itself too many times without stopping (infinite recursion?)`,
  maxIterationsReached: (max: number) =>
    `Program stopped after ${max} steps: it looks like an infinite loop`,
  stuckWithoutProgress: () =>
    "Program stopped: it loops forever without Karel doing anything (empty loop?)",
  programNotLoaded: () => "No program loaded",

  // Map validation
  invalidWall: (x1: number, y1: number, x2: number, y2: number) =>
    `Invalid wall: cells (${x1}, ${y1}) and (${x2}, ${y2}) are not adjacent`,

  // Parser
  emptyProgram: () => "The program is empty. Start with BEGINNING-OF-PROGRAM",
  missingProgramStart: () => "Missing BEGINNING-OF-PROGRAM at the start of the program",
  missingProgramEnd: () => "Missing END-OF-PROGRAM at the end of the program",
  missingExecutionStart: () => "Missing BEGINNING-OF-EXECUTION before the instructions",
  missingExecutionEnd: () => "Missing END-OF-EXECUTION after the instructions",
  missingTurnoff: () => "The program never calls 'turnoff'. Karel programs should end with turnoff;",
  expectedKeyword: (keyword: string, found: string) =>
    `Expected ${keyword} but found '${found || "end of file"}'`,
  expectedInstructionName: () => "Expected an instruction name after DEFINE-NEW-INSTRUCTION",
  duplicateInstruction: (name: string) =>
    `Instruction '${name}' is defined more than once; the last definition wins`,
  cannotRedefineBuiltIn: (name: string) => `Cannot redefine the built-in instruction '${name}'`,
  missingSemicolon: () => "Missing semicolon (;) after this instruction",
  unexpectedSemicolon: () => "Unexpected semicolon (;)",
  unexpectedToken: (value: string) => `Unexpected '${value || "end of file"}' here`,
  invalidIterateCount: () => "ITERATE needs a number, e.g. ITERATE 3 TIMES",
  contentAfterProgramEnd: () => "Unexpected content after END-OF-PROGRAM",
};
