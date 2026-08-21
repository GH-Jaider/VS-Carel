/**
 * Did a program reach the goal?
 *
 * This lives in the core because two very different things ask the question
 * and they must not answer it differently: the command line grades a
 * directory of submissions with it, and the browser tells a student their
 * chapter is solved with it. A second implementation on either side would
 * eventually pass someone in one place and fail them in the other, which is
 * the worst thing a teaching tool can do.
 */

import { ErrorMessages } from "./messages";
import type { KarelMap } from "./world";

/**
 * Do these two worlds describe the same exercise?
 *
 * Dimensions and walls are the parts of a world no instruction can reach, so
 * a difference there is not a grading signal — it is proof the expected world
 * came from somewhere else. Unchecked, it fails in the dangerous direction: a
 * submission that happens to end on the right corner passes against a key for
 * a completely different problem.
 *
 * Returns null when they match, or a description of the first difference.
 */
export function sameExercise(world: KarelMap, expected: KarelMap): string | null {
  const w = world.dimensions;
  const e = expected.dimensions;
  if (w.width !== e.width || w.height !== e.height) {
    return ErrorMessages.goalDifferentSize(w.width, w.height, e.width, e.height);
  }

  // Wall order is whatever the file happened to list, and a wall is the same
  // wall read from either side, so compare canonical keys as sets.
  const inWorld = wallKeys(world);
  const inExpected = wallKeys(expected);
  if (inWorld.size !== inExpected.size) {
    return ErrorMessages.goalDifferentWallCount(inWorld.size, inExpected.size);
  }
  for (const key of inWorld) {
    if (!inExpected.has(key)) {
      return ErrorMessages.goalWallNotInExpected(key);
    }
  }

  return null;
}

function wallKeys(map: KarelMap): Set<string> {
  return new Set(
    map.walls.map(({ from, to }) => {
      const ends = [`(${from.x}, ${from.y})`, `(${to.x}, ${to.y})`].sort();
      return `${ends[0]}–${ends[1]}`;
    })
  );
}

export interface CompareOptions {
  /** Accept any final orientation. Many exercises only say where to end up. */
  ignoreFacing?: boolean;
}

/**
 * Compare the parts of a world a program can change, and describe the first
 * difference in the terms a student would use — "a beeper at (3, 4)", not a
 * JSON diff. Dimensions and walls are not compared here; sameExercise checks
 * those up front, because a difference there means the run was set up wrong.
 *
 * Returns null when the world matches the goal.
 */
export function compareWorlds(
  expected: KarelMap,
  actual: KarelMap,
  options: CompareOptions = {}
): string | null {
  const e = expected.karel;
  const a = actual.karel;

  if (e.x !== a.x || e.y !== a.y) {
    return ErrorMessages.goalWrongCorner(e.x, e.y, a.x, a.y);
  }
  if (!options.ignoreFacing && e.facing !== a.facing) {
    return ErrorMessages.goalWrongFacing(e.facing, a.facing);
  }
  if (e.beepers !== a.beepers) {
    return ErrorMessages.goalWrongBag(e.beepers, a.beepers);
  }

  const expectedPiles = pileMap(expected);
  const actualPiles = pileMap(actual);
  for (const [corner, count] of expectedPiles) {
    const found = actualPiles.get(corner) ?? 0;
    if (found !== count) {
      return ErrorMessages.goalWrongPile(count, corner, found);
    }
  }
  for (const [corner, count] of actualPiles) {
    if (!expectedPiles.has(corner)) {
      return ErrorMessages.goalUnexpectedPile(corner, count);
    }
  }

  return null;
}

function pileMap(map: KarelMap): Map<string, number> {
  return new Map(map.beepers.filter((b) => b.count > 0).map((b) => [`(${b.x}, ${b.y})`, b.count]));
}
