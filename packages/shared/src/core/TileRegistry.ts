import { TileData, createTileData } from './TileData';
import { TileType } from '../enums/TileType';
import { ReflectorType } from '../enums/ReflectorType';
import { Direction } from '../enums/Direction';

// UniqueIndex 상수 (Classic1 호환)
export const TILE_INDEX = {
  EMPTY: 1,
  START_RIGHT: 2,   // 오른쪽으로 발사하는 스타트 (P1용)
  START_LEFT: 3,    // 왼쪽으로 발사하는 스타트 (P2용)
  GOAL: 4,
  BLOCK: 7,
  FIXED_TOPLEFT: 10,
  FIXED_TOPRIGHT: 11,
  FIXED_BOTTOMLEFT: 12,
  FIXED_BOTTOMRIGHT: 13,
  PORTAL_A: 20,
  PORTAL_B: 21,
} as const;

export function createBattleTileRegistry(): Map<number, TileData> {
  const registry = new Map<number, TileData>();

  registry.set(TILE_INDEX.EMPTY, createTileData({
    uniqueIndex: TILE_INDEX.EMPTY,
    tileType: TileType.Empty,
    isReflectorSetable: true,
    isPassable: true,
  }));

  registry.set(TILE_INDEX.START_RIGHT, createTileData({
    uniqueIndex: TILE_INDEX.START_RIGHT,
    tileType: TileType.Start,
    ballCreateDirections: [Direction.Right],
    isReflectorSetable: false,
    isPassable: true,
  }));

  registry.set(TILE_INDEX.START_LEFT, createTileData({
    uniqueIndex: TILE_INDEX.START_LEFT,
    tileType: TileType.Start,
    ballCreateDirections: [Direction.Left],
    isReflectorSetable: false,
    isPassable: true,
  }));

  registry.set(TILE_INDEX.GOAL, createTileData({
    uniqueIndex: TILE_INDEX.GOAL,
    tileType: TileType.Goal,
    isReflectorSetable: false,
    isPassable: true,
    isGoal: true,
  }));

  registry.set(TILE_INDEX.BLOCK, createTileData({
    uniqueIndex: TILE_INDEX.BLOCK,
    tileType: TileType.Block,
    isReflectorSetable: false,
    isPassable: false,
  }));

  // 고정 반사판 4종
  registry.set(TILE_INDEX.FIXED_TOPLEFT, createTileData({
    uniqueIndex: TILE_INDEX.FIXED_TOPLEFT,
    tileType: TileType.FixedReflector,
    reflectorType: ReflectorType.TopLeft,
    isReflectorSetable: false,
    isPassable: true,
  }));

  registry.set(TILE_INDEX.FIXED_TOPRIGHT, createTileData({
    uniqueIndex: TILE_INDEX.FIXED_TOPRIGHT,
    tileType: TileType.FixedReflector,
    reflectorType: ReflectorType.TopRight,
    isReflectorSetable: false,
    isPassable: true,
  }));

  registry.set(TILE_INDEX.FIXED_BOTTOMLEFT, createTileData({
    uniqueIndex: TILE_INDEX.FIXED_BOTTOMLEFT,
    tileType: TileType.FixedReflector,
    reflectorType: ReflectorType.BottomLeft,
    isReflectorSetable: false,
    isPassable: true,
  }));

  registry.set(TILE_INDEX.FIXED_BOTTOMRIGHT, createTileData({
    uniqueIndex: TILE_INDEX.FIXED_BOTTOMRIGHT,
    tileType: TileType.FixedReflector,
    reflectorType: ReflectorType.BottomRight,
    isReflectorSetable: false,
    isPassable: true,
  }));

  return registry;
}
