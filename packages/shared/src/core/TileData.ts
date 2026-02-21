import { TileType } from '../enums/TileType';
import { ReflectorType } from '../enums/ReflectorType';
import { Direction } from '../enums/Direction';

export interface TileData {
  uniqueIndex: number;
  tileType: TileType;
  ballCreateDirections: Direction[];  // 파싱 완료된 방향 배열
  isReflectorSetable: boolean;
  isPassable: boolean;
  isGoal: boolean;
  isGold: boolean;
  isPortal: boolean;
  portalGroupId: number;
  reflectorType: ReflectorType;
  goalCount: number;  // 기본값 1
}

// 미리 정의된 타일 데이터 (UniqueIndex 기반)
export const EMPTY_TILE_INDEX = 1;

export function createTileData(overrides: Partial<TileData> & { uniqueIndex: number; tileType: TileType }): TileData {
  return {
    ballCreateDirections: [],
    isReflectorSetable: false,
    isPassable: true,
    isGoal: false,
    isGold: false,
    isPortal: false,
    portalGroupId: 0,
    reflectorType: ReflectorType.None,
    goalCount: 1,
    ...overrides,
  };
}
