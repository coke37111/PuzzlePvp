import { TileData } from './TileData';
import { TileType } from '../enums/TileType';
import { ReflectorType } from '../enums/ReflectorType';
import { Direction } from '../enums/Direction';

export class TileModel {
  readonly x: number;
  readonly y: number;
  tileData: TileData;
  placedReflectorType: ReflectorType = ReflectorType.None;

  get index(): number {
    return this.x + this.y * 100;
  }

  get isEmpty(): boolean {
    return this.tileData.uniqueIndex === 1;
  }

  get isStartPosition(): boolean {
    return this.tileData.tileType === TileType.Start;
  }

  get isGoal(): boolean {
    return this.tileData.isGoal;
  }

  get isPortal(): boolean {
    return this.tileData.isPortal;
  }

  get isSplit(): boolean {
    return this.tileData.tileType === TileType.Split;
  }

  get isFixedReflector(): boolean {
    return this.tileData.tileType === TileType.FixedReflector;
  }

  get isTurnReflector(): boolean {
    return this.tileData.tileType === TileType.TurnLeftReflector ||
      this.tileData.tileType === TileType.TurnRightReflector;
  }

  get isCore(): boolean {
    return this.tileData.tileType === TileType.Core;
  }

  get isBlock(): boolean {
    return !this.tileData.isPassable;
  }

  get isGold(): boolean {
    return this.tileData.isGold;
  }

  get portalGroupId(): number {
    return this.tileData.portalGroupId;
  }

  get startDirection(): Direction {
    if (this.tileData.tileType === TileType.Start && this.tileData.ballCreateDirections.length > 0) {
      return this.tileData.ballCreateDirections[0];
    }
    return Direction.None;
  }

  get splitDirections(): Direction[] {
    if (!this.isSplit) return [];
    return this.tileData.ballCreateDirections;
  }

  get isReflectorSetable(): boolean {
    return this.tileData.isReflectorSetable;
  }

  get goalCount(): number {
    return this.tileData.goalCount;
  }

  constructor(data: TileData, x: number = 0, y: number = 0) {
    this.tileData = data;
    this.x = x;
    this.y = y;
  }

  reset(): void {
    this.placedReflectorType = ReflectorType.None;
  }

  // Up: y가 감소하는 방향 (BallSimulator.FindNearTile 기준)
  // Down: y가 증가하는 방향
  static getDirection(from: TileModel, to: TileModel): Direction {
    if (from.x === to.x) {
      return from.y > to.y ? Direction.Up : Direction.Down;
    } else if (from.y === to.y) {
      return from.x < to.x ? Direction.Right : Direction.Left;
    }
    return Direction.None;
  }
}
