import { TileData, createTileData } from './TileData';
import { TileType } from '../enums/TileType';
import { ReflectorType } from '../enums/ReflectorType';
import { Direction } from '../enums/Direction';

// UniqueIndex 상수 (Classic1 호환)
export const TILE_INDEX = {
  EMPTY: 1,
  START_RIGHT: 2,   // 오른쪽으로 발사하는 스타트 (P1용: (2,7))
  START_LEFT: 3,    // 왼쪽으로 발사하는 스타트 (P2용: (6,1))
  START_UP: 4,      // 위쪽으로 발사하는 스타트 (P1용: (1,6))
  START_DOWN: 5,    // 아래쪽으로 발사하는 스타트 (P2용: (7,2))
  CORE_P1: 6,       // P1 코어 (1,7)
  BLOCK: 7,
  CORE_P2: 8,       // P2 코어 (7,1)
  FIXED_SLASH: 10,
  FIXED_BACKSLASH: 11,
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

  registry.set(TILE_INDEX.START_UP, createTileData({
    uniqueIndex: TILE_INDEX.START_UP,
    tileType: TileType.Start,
    ballCreateDirections: [Direction.Up],
    isReflectorSetable: false,
    isPassable: true,
  }));

  registry.set(TILE_INDEX.START_DOWN, createTileData({
    uniqueIndex: TILE_INDEX.START_DOWN,
    tileType: TileType.Start,
    ballCreateDirections: [Direction.Down],
    isReflectorSetable: false,
    isPassable: true,
  }));

  registry.set(TILE_INDEX.CORE_P1, createTileData({
    uniqueIndex: TILE_INDEX.CORE_P1,
    tileType: TileType.Core,
    isReflectorSetable: false,
    isPassable: true,
  }));

  registry.set(TILE_INDEX.CORE_P2, createTileData({
    uniqueIndex: TILE_INDEX.CORE_P2,
    tileType: TileType.Core,
    isReflectorSetable: false,
    isPassable: true,
  }));

  registry.set(TILE_INDEX.BLOCK, createTileData({
    uniqueIndex: TILE_INDEX.BLOCK,
    tileType: TileType.Block,
    isReflectorSetable: false,
    isPassable: false,
  }));

  // 고정 반사판 2종
  registry.set(TILE_INDEX.FIXED_SLASH, createTileData({
    uniqueIndex: TILE_INDEX.FIXED_SLASH,
    tileType: TileType.FixedReflector,
    reflectorType: ReflectorType.Slash,
    isReflectorSetable: false,
    isPassable: true,
  }));

  registry.set(TILE_INDEX.FIXED_BACKSLASH, createTileData({
    uniqueIndex: TILE_INDEX.FIXED_BACKSLASH,
    tileType: TileType.FixedReflector,
    reflectorType: ReflectorType.Backslash,
    isReflectorSetable: false,
    isPassable: true,
  }));

  return registry;
}
