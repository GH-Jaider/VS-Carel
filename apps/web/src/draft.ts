/**
 * Editing a world.
 *
 * Every function here takes a map and returns a new one, so the editor never
 * mutates what the Session is holding and undo is a matter of keeping the old
 * value. They are also the whole of the editing semantics, which means the
 * rules — where Karel may stand, which boundaries can carry a wall, what
 * happens to things outside a shrunken world — are testable without a canvas
 * or a pointer.
 *
 * A wall lives on the boundary between two adjacent cells, not in a cell, and
 * `wallKey` reads it the same from either side. The world's rim is always
 * walled by the interpreter itself, so it is never stored and never togglable.
 */

import { MAX_WORLD_SIZE, type KarelMap, type Wall } from "@karel/core";

/** Two cells name the same boundary whichever order they arrive in. */
function wallKey(wall: Wall): string {
  const ends = [`${wall.from.x},${wall.from.y}`, `${wall.to.x},${wall.to.y}`].sort();
  return `${ends[0]}|${ends[1]}`;
}

function clone(map: KarelMap): KarelMap {
  return {
    dimensions: { ...map.dimensions },
    karel: { ...map.karel },
    beepers: map.beepers.map((b) => ({ ...b })),
    walls: map.walls.map((w) => ({ from: { ...w.from }, to: { ...w.to } })),
  };
}

function inside(map: KarelMap, x: number, y: number): boolean {
  return x >= 1 && y >= 1 && x <= map.dimensions.width && y <= map.dimensions.height;
}

/** Add the wall if the boundary is bare, remove it if it is not. */
export function toggleWall(map: KarelMap, wall: Wall): KarelMap {
  const key = wallKey(wall);
  const next = clone(map);
  const at = next.walls.findIndex((w) => wallKey(w) === key);
  if (at >= 0) {
    next.walls.splice(at, 1);
  } else {
    next.walls.push({ from: { ...wall.from }, to: { ...wall.to } });
  }
  return next;
}

/**
 * Change the pile on a corner by `delta`, floor zero. A pile of zero is
 * removed rather than stored, because `count: 0` is not a legal .klm and a
 * world that has been edited down to nothing must still validate.
 */
export function changeBeepers(map: KarelMap, x: number, y: number, delta: number): KarelMap {
  if (!inside(map, x, y)) {
    return map;
  }
  const next = clone(map);
  const pile = next.beepers.find((b) => b.x === x && b.y === y);
  const count = Math.max(0, (pile?.count ?? 0) + delta);

  next.beepers = next.beepers.filter((b) => !(b.x === x && b.y === y));
  if (count > 0) {
    next.beepers.push({ x, y, count });
  }
  return next;
}

export function placeKarel(map: KarelMap, x: number, y: number): KarelMap {
  if (!inside(map, x, y)) {
    return map;
  }
  const next = clone(map);
  next.karel.x = x;
  next.karel.y = y;
  return next;
}

const TURN_ORDER = ["north", "west", "south", "east"] as const;

/** Rotate Karel a quarter turn left, the only turn the language has. */
export function turnKarel(map: KarelMap): KarelMap {
  const next = clone(map);
  const at = TURN_ORDER.indexOf(next.karel.facing as (typeof TURN_ORDER)[number]);
  next.karel.facing = TURN_ORDER[(at + 1) % TURN_ORDER.length];
  return next;
}

export function setBag(map: KarelMap, beepers: number): KarelMap {
  const next = clone(map);
  next.karel.beepers = Math.max(0, Math.floor(beepers));
  return next;
}

/**
 * Resize, dropping whatever no longer fits.
 *
 * Shrinking is destructive and there is no honest alternative: a beeper
 * outside the new bounds cannot be kept, and a wall to a cell that no longer
 * exists is not a wall. Karel is moved rather than dropped — a world without
 * him is not a world — so he ends up on the nearest corner still inside.
 */
export function resize(map: KarelMap, width: number, height: number): KarelMap {
  const w = Math.min(MAX_WORLD_SIZE, Math.max(1, Math.floor(width)));
  const h = Math.min(MAX_WORLD_SIZE, Math.max(1, Math.floor(height)));

  const next = clone(map);
  next.dimensions = { width: w, height: h };
  next.karel.x = Math.min(next.karel.x, w);
  next.karel.y = Math.min(next.karel.y, h);
  next.beepers = next.beepers.filter((b) => b.x <= w && b.y <= h);
  next.walls = next.walls.filter(
    (wall) => wall.from.x <= w && wall.to.x <= w && wall.from.y <= h && wall.to.y <= h
  );
  return next;
}

export function clearBeepers(map: KarelMap): KarelMap {
  const next = clone(map);
  next.beepers = [];
  return next;
}

export function clearWalls(map: KarelMap): KarelMap {
  const next = clone(map);
  next.walls = [];
  return next;
}

/** How many beepers sit on a corner, for the editor's readout. */
export function beepersAt(map: KarelMap, x: number, y: number): number {
  return map.beepers.find((b) => b.x === x && b.y === y)?.count ?? 0;
}
