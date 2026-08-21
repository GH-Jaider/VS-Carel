/**
 * Constants for Karel language validation.
 */

/**
 * Valid condition names (the 18 classic conditions: each test and its negation).
 */
export const VALID_CONDITIONS = new Set([
  "front-is-clear",
  "front-is-blocked",
  "left-is-clear",
  "left-is-blocked",
  "right-is-clear",
  "right-is-blocked",
  "next-to-a-beeper",
  "not-next-to-a-beeper",
  "facing-north",
  "not-facing-north",
  "facing-south",
  "not-facing-south",
  "facing-east",
  "not-facing-east",
  "facing-west",
  "not-facing-west",
  "beeper-in-bag",
  "no-beeper-in-bag",
]);

/**
 * Built-in instruction names.
 */
export const BUILT_IN_INSTRUCTIONS = new Set([
  "move",
  "turnleft",
  "pickbeeper",
  "putbeeper",
  "turnoff",
]);
