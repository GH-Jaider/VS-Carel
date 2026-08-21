/**
 * Every user-facing string the core produces, in one place.
 *
 * Nothing in the core builds a message inline: routing them all through here
 * keeps the wording reviewable as a set and gives translation a single seam,
 * without any host having to match on prose.
 *
 * The English catalogue is the definition. Every other one is annotated with
 * its type, so a missing key or a changed parameter list is a compile error
 * rather than a sentence that silently falls back to English in front of a
 * classroom.
 *
 * ErrorMessages keeps the shape it always had — a plain object of functions —
 * so every existing caller is unaffected by the locale existing at all. The
 * lookup happens when a message is built, not when the module loads, so
 * switching language re-words errors that are already on screen.
 */

export type Locale = "en" | "es";

const en = {
  // Runtime (error shutoffs)
  moveBlocked: () => "Karel hit a wall: the front is blocked",
  noBeepersToPickUp: (x: number, y: number) =>
    `There is no beeper to pick up at corner (${x}, ${y})`,
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
  missingKarel: () => 'Missing "karel" ({ "x": ..., "y": ..., "facing": ..., "beepers": ... })',
  invalidKarelPosition: () => '"karel.x" and "karel.y" must be whole numbers',
  karelOutOfBounds: (x: number, y: number, width: number, height: number) =>
    `Karel is outside the world: (${x}, ${y}) in a ${width}x${height} world`,
  invalidKarelFacing: () => '"karel.facing" must be "north", "south", "east" or "west"',
  unknownKarelFacing: (value: string) => `"karel.facing" has an invalid value: "${value}"`,
  invalidKarelBeepers: () => '"karel.beepers" must be a whole number of 0 or more',
  beepersNotAnArray: () => '"beepers" must be an array',
  invalidBeeperEntry: (n: number) => `Beeper #${n} must look like { "x": 3, "y": 3, "count": 1 }`,
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
  missingTurnoff: () =>
    "The program never calls 'turnoff'. Karel programs should end with turnoff;",
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
} as const;

/** The shape every catalogue has to satisfy. */
type Catalogue = { [K in keyof typeof en]: (typeof en)[K] };

/**
 * Spanish.
 *
 * "Zumbador" rather than "beeper": it is the term Spanish-language Karel
 * teaching already uses, and a student who has read the exercise in Spanish
 * has met that word and not the English one. The instruction names stay as
 * they are — `pickbeeper` is what you type either way — so the messages name
 * the keyword when the connection is worth making explicit.
 */
const es: Catalogue = {
  // Runtime (error shutoffs)
  moveBlocked: () => "Karel chocó contra un muro: el frente está bloqueado",
  noBeepersToPickUp: (x, y) => `No hay ningún zumbador que recoger en la esquina (${x}, ${y})`,
  noBeepersInBag: () => "La mochila de Karel está vacía",
  unknownInstruction: (name) => `La instrucción '${name}' no existe`,
  unknownCondition: (name) => `La condición '${name}' no existe`,
  recursionTooDeep: (name) =>
    `La instrucción '${name}' se llama a sí misma sin parar (¿recursión infinita?)`,
  maxIterationsReached: (max) =>
    `El programa se detuvo tras ${max} pasos: parece un bucle infinito`,
  stuckWithoutProgress: () =>
    "El programa se detuvo: da vueltas para siempre sin que Karel haga nada (¿bucle vacío?)",
  programNotLoaded: () => "No hay ningún programa cargado",
  invalidWall: (x1, y1, x2, y2) =>
    `Muro inválido: las celdas (${x1}, ${y1}) y (${x2}, ${y2}) no son adyacentes`,

  // Map validation (.klm)
  mapNotAnObject: () => "El mapa debe ser un objeto JSON",
  missingDimensions: () => 'Falta "dimensions" ({ "width": ..., "height": ... })',
  invalidWidth: () => '"dimensions.width" debe ser un número entero de al menos 1',
  widthTooLarge: (max) => `"dimensions.width" no puede ser mayor que ${max}`,
  invalidHeight: () => '"dimensions.height" debe ser un número entero de al menos 1',
  heightTooLarge: (max) => `"dimensions.height" no puede ser mayor que ${max}`,
  missingKarel: () => 'Falta "karel" ({ "x": ..., "y": ..., "facing": ..., "beepers": ... })',
  invalidKarelPosition: () => '"karel.x" y "karel.y" deben ser números enteros',
  karelOutOfBounds: (x, y, width, height) =>
    `Karel está fuera del mundo: (${x}, ${y}) en un mundo de ${width}x${height}`,
  invalidKarelFacing: () => '"karel.facing" debe ser "north", "south", "east" o "west"',
  unknownKarelFacing: (value) => `"karel.facing" tiene un valor inválido: "${value}"`,
  invalidKarelBeepers: () => '"karel.beepers" debe ser un número entero de 0 o más',
  beepersNotAnArray: () => '"beepers" debe ser una lista',
  invalidBeeperEntry: (n) => `El zumbador n.º ${n} debe ser { "x": 3, "y": 3, "count": 1 }`,
  beeperOutOfBounds: (n, x, y) => `El zumbador n.º ${n} está fuera del mundo: (${x}, ${y})`,
  invalidBeeperCount: (n) => `El zumbador n.º ${n} debe tener una cantidad de al menos 1`,
  wallsNotAnArray: () => '"walls" debe ser una lista',
  invalidWallEntry: (n) =>
    `El muro n.º ${n} debe ser { "from": { "x": 4, "y": 3 }, "to": { "x": 4, "y": 4 } }`,
  wallOutOfBounds: (n) => `El muro n.º ${n} toca una celda fuera del mundo`,
  wallNotAdjacent: (n, x1, y1, x2, y2) =>
    `Muro n.º ${n}: las celdas (${x1}, ${y1}) y (${x2}, ${y2}) no son adyacentes`,

  // Parser
  emptyProgram: () => "El programa está vacío. Empieza con BEGINNING-OF-PROGRAM",
  missingProgramStart: () => "Falta BEGINNING-OF-PROGRAM al principio del programa",
  missingProgramEnd: () => "Falta END-OF-PROGRAM al final del programa",
  missingExecutionStart: () => "Falta BEGINNING-OF-EXECUTION antes de las instrucciones",
  missingExecutionEnd: () => "Falta END-OF-EXECUTION después de las instrucciones",
  missingTurnoff: () =>
    "El programa nunca llama a 'turnoff'. Un programa de Karel debería terminar con turnoff;",
  expectedKeyword: (keyword, found) =>
    `Se esperaba ${keyword} pero se encontró '${found || "el final del archivo"}'`,
  expectedInstructionName: () =>
    "Se esperaba el nombre de una instrucción después de DEFINE-NEW-INSTRUCTION",
  duplicateInstruction: (name) =>
    `La instrucción '${name}' está definida más de una vez; vale la última definición`,
  cannotRedefineBuiltIn: (name) => `No se puede redefinir la instrucción básica '${name}'`,
  missingSemicolon: () => "Falta un punto y coma (;) después de esta instrucción",
  unexpectedSemicolon: () => "Punto y coma (;) inesperado",
  unexpectedToken: (value) => `'${value || "el final del archivo"}' no puede ir aquí`,
  invalidIterateCount: () => "ITERATE necesita un número, por ejemplo ITERATE 3 TIMES",
  contentAfterProgramEnd: () => "Hay contenido después de END-OF-PROGRAM",
};

const CATALOGUES: Record<Locale, Catalogue> = { en, es };

let locale: Locale = "en";

export function setLocale(next: Locale): void {
  locale = next;
}

export function getLocale(): Locale {
  return locale;
}

/**
 * The catalogue every consumer already imports.
 *
 * Each entry forwards to whichever language is current at the moment it is
 * called. The cast is the one unavoidable piece: TypeScript cannot infer that
 * a mapped set of forwarders preserves each signature, but `es: Catalogue`
 * above already proves every catalogue matches, which is the property that
 * actually matters.
 */
export const ErrorMessages = Object.fromEntries(
  Object.keys(en).map((key) => [
    key,
    (...args: unknown[]) =>
      (CATALOGUES[locale][key as keyof Catalogue] as (...a: unknown[]) => string)(...args),
  ])
) as Catalogue;
