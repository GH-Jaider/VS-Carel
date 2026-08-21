/**
 * Every user-facing string the core produces, in one place.
 *
 * Nothing in the core builds a message inline: routing them all through here
 * keeps the wording reviewable as a set and leaves a single seam to translate
 * behind, without any host having to match on prose.
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
  invalidWall: (x1: number, y1: number, x2: number, y2: number) =>
    `Invalid wall: cells (${x1}, ${y1}) and (${x2}, ${y2}) are not adjacent`,

  // Map validation (.klm). These are collected, not thrown: validateKarelMap
  // reports everything wrong with a file in one pass, so each entry has to
  // stand on its own next to the others.
  mapNotAnObject: () => "The map must be a JSON object",
  missingDimensions: () => 'Missing "dimensions" ({ "width": ..., "height": ... })',
  invalidWidth: () => '"dimensions.width" must be a whole number of at least 1',
  widthTooLarge: (max: number) => `"dimensions.width" cannot be larger than ${max}`,
  invalidHeight: () => '"dimensions.height" must be a whole number of at least 1',
  heightTooLarge: (max: number) => `"dimensions.height" cannot be larger than ${max}`,
  missingKarel: () =>
    'Missing "karel" ({ "x": ..., "y": ..., "facing": ..., "beepers": ... })',
  invalidKarelPosition: () => '"karel.x" and "karel.y" must be whole numbers',
  karelOutOfBounds: (x: number, y: number, width: number, height: number) =>
    `Karel is outside the world: (${x}, ${y}) in a ${width}x${height} world`,
  invalidKarelFacing: () => '"karel.facing" must be "north", "south", "east" or "west"',
  unknownKarelFacing: (value: string) => `"karel.facing" has an invalid value: "${value}"`,
  invalidKarelBeepers: () => '"karel.beepers" must be a whole number of 0 or more',
  beepersNotAnArray: () => '"beepers" must be an array',
  invalidBeeperEntry: (n: number) =>
    `Beeper #${n} must look like { "x": 3, "y": 3, "count": 1 }`,
  beeperOutOfBounds: (n: number, x: number, y: number) =>
    `Beeper #${n} is outside the world: (${x}, ${y})`,
  invalidBeeperCount: (n: number) => `Beeper #${n} must have a count of at least 1`,
  wallsNotAnArray: () => '"walls" must be an array',
  invalidWallEntry: (n: number) =>
    `Wall #${n} must look like { "from": { "x": 4, "y": 3 }, "to": { "x": 4, "y": 4 } }`,
  wallOutOfBounds: (n: number) => `Wall #${n} touches a cell outside the world`,
  wallNotAdjacent: (n: number, x1: number, y1: number, x2: number, y2: number) =>
    `Wall #${n}: cells (${x1}, ${y1}) and (${x2}, ${y2}) are not adjacent`,

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
