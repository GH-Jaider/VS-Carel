/**
 * Karel World - Graph-based representation of Karel's environment.
 *
 * The world is represented as an implicit graph where:
 * - Each cell (x, y) is a node (1-based, (1,1) at the bottom-left)
 * - Walls are defined as blocked connections between adjacent cells
 * - Two cells are connected if there's no wall between them
 *
 * A World instance is a running snapshot: it is built from a KarelMap and
 * mutated by execution, but it never writes back to the map. The .klm file
 * is always the initial state; resetting means building a fresh World.
 */

import { Karel, Position, Direction, parseDirection } from "@/interpreter/karel";
import { ErrorMessages } from "@/interpreter/messages";

/**
 * Represents a wall between two adjacent cells.
 * Walls are bidirectional: a wall from A to B also blocks B to A.
 */
export interface Wall {
  from: Position;
  to: Position;
}

/**
 * Represents beepers at a specific position.
 */
export interface BeeperStack {
  x: number;
  y: number;
  count: number;
}

/**
 * World dimensions.
 */
export interface Dimensions {
  width: number;
  height: number;
}

/**
 * Karel Map file format (.klm)
 */
export interface KarelMap {
  dimensions: Dimensions;
  karel: {
    x: number;
    y: number;
    facing: string;
    beepers: number;
  };
  beepers: BeeperStack[];
  walls: Wall[];
}

export const MAX_WORLD_SIZE = 100;

/**
 * Result of validating raw .klm data.
 */
export interface MapValidationResult {
  ok: boolean;
  errors: string[];
  map?: KarelMap;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

/**
 * Canonical validation for .klm map data. Every load path (files, previews,
 * execution) should go through this before constructing a World.
 * Returns friendly errors and, on success, a normalized KarelMap.
 */
export function validateKarelMap(data: unknown): MapValidationResult {
  const errors: string[] = [];

  if (!isRecord(data)) {
    return { ok: false, errors: ["The map must be a JSON object"] };
  }

  // dimensions
  let width = 0;
  let height = 0;
  if (!isRecord(data.dimensions)) {
    errors.push('Missing "dimensions" ({ "width": ..., "height": ... })');
  } else {
    if (!isInt(data.dimensions.width) || data.dimensions.width < 1) {
      errors.push('"dimensions.width" must be a whole number of at least 1');
    } else if (data.dimensions.width > MAX_WORLD_SIZE) {
      errors.push(`"dimensions.width" cannot be larger than ${MAX_WORLD_SIZE}`);
    } else {
      width = data.dimensions.width;
    }
    if (!isInt(data.dimensions.height) || data.dimensions.height < 1) {
      errors.push('"dimensions.height" must be a whole number of at least 1');
    } else if (data.dimensions.height > MAX_WORLD_SIZE) {
      errors.push(`"dimensions.height" cannot be larger than ${MAX_WORLD_SIZE}`);
    } else {
      height = data.dimensions.height;
    }
  }

  const inBounds = (x: number, y: number): boolean =>
    width > 0 && height > 0 && x >= 1 && x <= width && y >= 1 && y <= height;

  // karel
  let karel: KarelMap["karel"] | null = null;
  if (!isRecord(data.karel)) {
    errors.push('Missing "karel" ({ "x": ..., "y": ..., "facing": ..., "beepers": ... })');
  } else {
    const k = data.karel;
    if (!isInt(k.x) || !isInt(k.y)) {
      errors.push('"karel.x" and "karel.y" must be whole numbers');
    } else if (width > 0 && height > 0 && !inBounds(k.x, k.y)) {
      errors.push(`Karel is outside the world: (${k.x}, ${k.y}) in a ${width}x${height} world`);
    }
    let facing = "north";
    if (typeof k.facing !== "string") {
      errors.push('"karel.facing" must be "north", "south", "east" or "west"');
    } else {
      try {
        facing = parseDirection(k.facing);
      } catch {
        errors.push(`"karel.facing" has an invalid value: "${k.facing}"`);
      }
    }
    const beepers = k.beepers === undefined ? 0 : k.beepers;
    if (!isInt(beepers) || beepers < 0) {
      errors.push('"karel.beepers" must be a whole number of 0 or more');
    }
    if (isInt(k.x) && isInt(k.y) && isInt(beepers)) {
      karel = { x: k.x, y: k.y, facing, beepers };
    }
  }

  // beepers
  const beepers: BeeperStack[] = [];
  if (data.beepers !== undefined) {
    if (!Array.isArray(data.beepers)) {
      errors.push('"beepers" must be an array');
    } else {
      data.beepers.forEach((entry, i) => {
        if (!isRecord(entry) || !isInt(entry.x) || !isInt(entry.y) || !isInt(entry.count)) {
          errors.push(`Beeper #${i + 1} must look like { "x": 3, "y": 3, "count": 1 }`);
          return;
        }
        if (!inBounds(entry.x, entry.y)) {
          errors.push(`Beeper #${i + 1} is outside the world: (${entry.x}, ${entry.y})`);
          return;
        }
        if (entry.count < 1) {
          errors.push(`Beeper #${i + 1} must have a count of at least 1`);
          return;
        }
        beepers.push({ x: entry.x, y: entry.y, count: entry.count });
      });
    }
  }

  // walls
  const walls: Wall[] = [];
  if (data.walls !== undefined) {
    if (!Array.isArray(data.walls)) {
      errors.push('"walls" must be an array');
    } else {
      data.walls.forEach((entry, i) => {
        if (
          !isRecord(entry) ||
          !isRecord(entry.from) ||
          !isRecord(entry.to) ||
          !isInt(entry.from.x) ||
          !isInt(entry.from.y) ||
          !isInt(entry.to.x) ||
          !isInt(entry.to.y)
        ) {
          errors.push(
            `Wall #${i + 1} must look like { "from": { "x": 4, "y": 3 }, "to": { "x": 4, "y": 4 } }`
          );
          return;
        }
        const from = { x: entry.from.x, y: entry.from.y };
        const to = { x: entry.to.x, y: entry.to.y };
        if (!inBounds(from.x, from.y) || !inBounds(to.x, to.y)) {
          errors.push(`Wall #${i + 1} touches a cell outside the world`);
          return;
        }
        if (!areAdjacent(from, to)) {
          errors.push(
            `Wall #${i + 1}: cells (${from.x}, ${from.y}) and (${to.x}, ${to.y}) are not adjacent`
          );
          return;
        }
        walls.push({ from, to });
      });
    }
  }

  if (errors.length > 0 || karel === null) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    errors: [],
    map: { dimensions: { width, height }, karel, beepers, walls },
  };
}

/**
 * Generates a unique key for a wall between two positions.
 * Normalizes the order so (A,B) and (B,A) produce the same key.
 */
function wallKey(from: Position, to: Position): string {
  if (from.x < to.x || (from.x === to.x && from.y < to.y)) {
    return `${from.x},${from.y}|${to.x},${to.y}`;
  }
  return `${to.x},${to.y}|${from.x},${from.y}`;
}

/**
 * Generates a unique key for a position.
 */
function positionKey(pos: Position): string {
  return `${pos.x},${pos.y}`;
}

/**
 * Check if two positions are adjacent (Manhattan distance = 1).
 */
function areAdjacent(a: Position, b: Position): boolean {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  return (dx === 1 && dy === 0) || (dx === 0 && dy === 1);
}

/**
 * Karel's World - manages the environment state.
 */
export class World {
  private _dimensions: Dimensions;
  private _karel: Karel;
  private _beepers: Map<string, number>; // positionKey -> count
  private _walls: Set<string>; // wallKey set

  constructor(map: KarelMap) {
    this._dimensions = { ...map.dimensions };
    this._karel = Karel.fromJSON(map.karel);

    this._beepers = new Map();
    for (const beeper of map.beepers) {
      const key = positionKey({ x: beeper.x, y: beeper.y });
      this._beepers.set(key, (this._beepers.get(key) ?? 0) + beeper.count);
    }

    this._walls = new Set();
    for (const wall of map.walls) {
      this.addWall(wall.from, wall.to);
    }
  }

  get dimensions(): Dimensions {
    return { ...this._dimensions };
  }

  get width(): number {
    return this._dimensions.width;
  }

  get height(): number {
    return this._dimensions.height;
  }

  get karel(): Karel {
    return this._karel;
  }

  /**
   * Add a wall between two adjacent cells.
   */
  addWall(from: Position, to: Position): void {
    if (!areAdjacent(from, to)) {
      throw new Error(ErrorMessages.invalidWall(from.x, from.y, to.x, to.y));
    }
    this._walls.add(wallKey(from, to));
  }

  /**
   * Check if there's a wall between two adjacent cells.
   */
  hasWall(from: Position, to: Position): boolean {
    return this._walls.has(wallKey(from, to));
  }

  /**
   * Check if a position is within world bounds.
   */
  isInBounds(pos: Position): boolean {
    return (
      pos.x >= 1 &&
      pos.x <= this._dimensions.width &&
      pos.y >= 1 &&
      pos.y <= this._dimensions.height
    );
  }

  /**
   * Check if movement from one position to another is blocked.
   * Blocked if: out of bounds OR wall exists between cells.
   */
  isBlocked(from: Position, to: Position): boolean {
    if (!this.isInBounds(to)) {
      return true;
    }
    return this.hasWall(from, to);
  }

  frontIsBlocked(): boolean {
    return this.isBlocked(this._karel.position, this._karel.frontPosition());
  }

  frontIsClear(): boolean {
    return !this.frontIsBlocked();
  }

  leftIsBlocked(): boolean {
    return this.isBlocked(this._karel.position, this._karel.leftPosition());
  }

  leftIsClear(): boolean {
    return !this.leftIsBlocked();
  }

  rightIsBlocked(): boolean {
    return this.isBlocked(this._karel.position, this._karel.rightPosition());
  }

  rightIsClear(): boolean {
    return !this.rightIsBlocked();
  }

  /**
   * Get beeper count at a position.
   */
  getBeepers(pos: Position): number {
    return this._beepers.get(positionKey(pos)) ?? 0;
  }

  nextToABeeper(): boolean {
    return this.getBeepers(this._karel.position) > 0;
  }

  beeperInBag(): boolean {
    return this._karel.hasBeepersInBag();
  }

  /**
   * Add beepers at a position.
   */
  addBeepers(pos: Position, count: number = 1): void {
    const key = positionKey(pos);
    const current = this._beepers.get(key) ?? 0;
    this._beepers.set(key, current + count);
  }

  /**
   * Remove a beeper from a position.
   * Returns false if no beepers at position.
   */
  removeBeeper(pos: Position): boolean {
    const key = positionKey(pos);
    const current = this._beepers.get(key) ?? 0;
    if (current <= 0) {
      return false;
    }
    if (current === 1) {
      this._beepers.delete(key);
    } else {
      this._beepers.set(key, current - 1);
    }
    return true;
  }

  // ========== Karel Actions ==========

  /**
   * Move Karel forward. Throws if front is blocked (error shutoff).
   */
  move(): void {
    if (this.frontIsBlocked()) {
      throw new Error(ErrorMessages.moveBlocked());
    }
    this._karel.move();
  }

  /**
   * Turn Karel left (counter-clockwise).
   */
  turnLeft(): void {
    this._karel.turnLeft();
  }

  /**
   * Pick up a beeper at Karel's position. Throws if there is none (error shutoff).
   */
  pickBeeper(): void {
    const pos = this._karel.position;
    if (!this.removeBeeper(pos)) {
      throw new Error(ErrorMessages.noBeepersToPickUp(pos.x, pos.y));
    }
    this._karel.pickBeeper();
  }

  /**
   * Put down a beeper at Karel's position. Throws if the bag is empty (error shutoff).
   */
  putBeeper(): void {
    if (!this._karel.putBeeper()) {
      throw new Error(ErrorMessages.noBeepersInBag());
    }
    this.addBeepers(this._karel.position);
  }

  // ========== Condition Checking ==========

  /**
   * Evaluate a condition by name.
   */
  evaluateCondition(condition: string): boolean {
    switch (condition.toLowerCase()) {
      case "front-is-clear":
        return this.frontIsClear();
      case "front-is-blocked":
        return this.frontIsBlocked();
      case "left-is-clear":
        return this.leftIsClear();
      case "left-is-blocked":
        return this.leftIsBlocked();
      case "right-is-clear":
        return this.rightIsClear();
      case "right-is-blocked":
        return this.rightIsBlocked();
      case "next-to-a-beeper":
        return this.nextToABeeper();
      case "not-next-to-a-beeper":
        return !this.nextToABeeper();
      case "facing-north":
        return this._karel.isFacing(Direction.North);
      case "not-facing-north":
        return !this._karel.isFacing(Direction.North);
      case "facing-south":
        return this._karel.isFacing(Direction.South);
      case "not-facing-south":
        return !this._karel.isFacing(Direction.South);
      case "facing-east":
        return this._karel.isFacing(Direction.East);
      case "not-facing-east":
        return !this._karel.isFacing(Direction.East);
      case "facing-west":
        return this._karel.isFacing(Direction.West);
      case "not-facing-west":
        return !this._karel.isFacing(Direction.West);
      case "beeper-in-bag":
        return this.beeperInBag();
      case "no-beeper-in-bag":
        return !this.beeperInBag();
      default:
        throw new Error(ErrorMessages.unknownCondition(condition));
    }
  }

  // ========== Serialization ==========

  /**
   * Get all beeper positions and counts.
   */
  getAllBeepers(): BeeperStack[] {
    const result: BeeperStack[] = [];
    for (const [key, count] of this._beepers) {
      const [x, y] = key.split(",").map(Number);
      result.push({ x, y, count });
    }
    return result;
  }

  /**
   * Get all walls.
   */
  getAllWalls(): Wall[] {
    const result: Wall[] = [];
    for (const key of this._walls) {
      const [fromStr, toStr] = key.split("|");
      const [fromX, fromY] = fromStr.split(",").map(Number);
      const [toX, toY] = toStr.split(",").map(Number);
      result.push({
        from: { x: fromX, y: fromY },
        to: { x: toX, y: toY },
      });
    }
    return result;
  }

  /**
   * Serialize world state to KarelMap format.
   */
  toJSON(): KarelMap {
    return {
      dimensions: { ...this._dimensions },
      karel: this._karel.toJSON(),
      beepers: this.getAllBeepers(),
      walls: this.getAllWalls(),
    };
  }
}
