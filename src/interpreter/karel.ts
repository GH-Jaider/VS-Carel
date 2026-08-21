/**
 * Direction enum for Karel robot orientation.
 */
export enum Direction {
  North = "north",
  West = "west",
  South = "south",
  East = "east",
}

/**
 * Represents a 2D coordinate position.
 */
export interface Position {
  x: number;
  y: number;
}

/**
 * Direction vectors for movement and checking adjacent cells.
 */
export const DirectionVectors: Record<Direction, Position> = {
  [Direction.North]: { x: 0, y: 1 },
  [Direction.West]: { x: -1, y: 0 },
  [Direction.South]: { x: 0, y: -1 },
  [Direction.East]: { x: 1, y: 0 },
};

/**
 * Direction mapping for 90° counter-clockwise rotation (left turn).
 */
const LeftTurnMap: Record<Direction, Direction> = {
  [Direction.North]: Direction.West,
  [Direction.West]: Direction.South,
  [Direction.South]: Direction.East,
  [Direction.East]: Direction.North,
};

/**
 * Direction mapping for 90° clockwise rotation (right turn).
 */
const RightTurnMap: Record<Direction, Direction> = {
  [Direction.North]: Direction.East,
  [Direction.East]: Direction.South,
  [Direction.South]: Direction.West,
  [Direction.West]: Direction.North,
};

/**
 * Parse a direction from a string.
 */
export function parseDirection(value: string): Direction {
  const normalized = value.toLowerCase();
  switch (normalized) {
    case "north":
    case "n":
      return Direction.North;
    case "west":
    case "w":
      return Direction.West;
    case "south":
    case "s":
      return Direction.South;
    case "east":
    case "e":
      return Direction.East;
    default:
      throw new Error(`Invalid direction string: ${value}`);
  }
}

/**
 * Karel robot state and operations.
 */
export class Karel {
  private _position: Position;
  private _facing: Direction;
  private _beepersInBag: number;

  constructor(
    position: Position = { x: 1, y: 1 },
    facing: Direction = Direction.North,
    beepersInBag: number = 0
  ) {
    this._position = { ...position };
    this._facing = facing;
    this._beepersInBag = beepersInBag;
  }

  /**
   * Current position of Karel.
   */
  get position(): Position {
    return { ...this._position };
  }

  /**
   * Current X coordinate.
   */
  get x(): number {
    return this._position.x;
  }

  /**
   * Current Y coordinate.
   */
  get y(): number {
    return this._position.y;
  }

  /**
   * Current direction Karel is facing.
   */
  get facing(): Direction {
    return this._facing;
  }

  /**
   * Number of beepers in Karel's bag.
   */
  get beepersInBag(): number {
    return this._beepersInBag;
  }

  /**
   * Check if Karel has beepers in the bag.
   */
  hasBeepersInBag(): boolean {
    return this._beepersInBag > 0;
  }

  /**
   * Get the position in front of Karel.
   */
  frontPosition(): Position {
    const vector = DirectionVectors[this._facing];
    return {
      x: this._position.x + vector.x,
      y: this._position.y + vector.y,
    };
  }

  /**
   * Get the position to Karel's left.
   */
  leftPosition(): Position {
    const leftDir = LeftTurnMap[this._facing];
    const vector = DirectionVectors[leftDir];
    return {
      x: this._position.x + vector.x,
      y: this._position.y + vector.y,
    };
  }

  /**
   * Get the position to Karel's right.
   */
  rightPosition(): Position {
    const rightDir = RightTurnMap[this._facing];
    const vector = DirectionVectors[rightDir];
    return {
      x: this._position.x + vector.x,
      y: this._position.y + vector.y,
    };
  }

  /**
   * Move Karel forward one cell.
   * This only updates Karel's position - wall checking should be done by World.
   */
  move(): void {
    const front = this.frontPosition();
    this._position = front;
  }

  /**
   * Turn Karel 90° counter-clockwise.
   */
  turnLeft(): void {
    this._facing = LeftTurnMap[this._facing];
  }

  /**
   * Pick up a beeper (adds to bag).
   * World should verify beeper exists at position.
   */
  pickBeeper(): void {
    this._beepersInBag++;
  }

  /**
   * Put down a beeper (removes from bag).
   * Returns false if no beepers in bag.
   */
  putBeeper(): boolean {
    if (this._beepersInBag <= 0) {
      return false;
    }
    this._beepersInBag--;
    return true;
  }

  /**
   * Check if Karel is facing a specific direction.
   */
  isFacing(direction: Direction): boolean {
    return this._facing === direction;
  }

  /**
   * Create a deep clone of Karel's current state.
   */
  clone(): Karel {
    return new Karel(this._position, this._facing, this._beepersInBag);
  }

  /**
   * Serialize Karel state to JSON-compatible object.
   */
  toJSON(): { x: number; y: number; facing: string; beepers: number } {
    return {
      x: this._position.x,
      y: this._position.y,
      facing: this._facing,
      beepers: this._beepersInBag,
    };
  }

  /**
   * Create Karel from JSON-compatible object.
   */
  static fromJSON(data: { x: number; y: number; facing: string; beepers?: number }): Karel {
    const facing = parseDirection(data.facing);
    return new Karel({ x: data.x, y: data.y }, facing, data.beepers ?? 0);
  }
}
