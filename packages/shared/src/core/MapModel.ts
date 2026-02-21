import { TileModel } from './TileModel';
import { TileData, createTileData, EMPTY_TILE_INDEX } from './TileData';
import { ReflectorType } from '../enums/ReflectorType';
import { TileType } from '../enums/TileType';
import { Direction } from '../enums/Direction';

export interface MapData {
  size: number;
  /** tiles[y][x] = TileData uniqueIndex */
  tiles: number[][];
  /** Portal 연결: portalGroupId → [tile1Index, tile2Index] */
  portalGroups?: Record<number, number[]>;
}

export interface ReflectorPlacement {
  x: number;
  y: number;
  type: ReflectorType;
  playerId: number;
}

export class MapModel {
  size: number;
  tiles: Map<number, TileModel> = new Map();  // key = index (x + y*100)
  reflectors: Map<number, ReflectorPlacement> = new Map();  // key = index
  linkedPortals: Map<TileModel, TileModel> = new Map();

  // TileData 레지스트리 (uniqueIndex → TileData)
  private tileRegistry: Map<number, TileData>;

  constructor(tileRegistry: Map<number, TileData>) {
    this.tileRegistry = tileRegistry;
    this.size = 0;
  }

  load(mapData: MapData): void {
    this.size = mapData.size;
    this.tiles.clear();
    this.reflectors.clear();
    this.linkedPortals.clear();

    for (let y = 0; y < mapData.size; y++) {
      for (let x = 0; x < mapData.size; x++) {
        const tileIndex = mapData.tiles[y][x];
        if (tileIndex < EMPTY_TILE_INDEX) continue;

        const tileData = this.tileRegistry.get(tileIndex);
        if (!tileData) {
          throw new Error(`TileData not found: ${tileIndex}`);
        }

        const tile = new TileModel(tileData, x, y);
        this.tiles.set(tile.index, tile);
      }
    }

    this.updatePortalLinks();
  }

  private updatePortalLinks(): void {
    this.linkedPortals.clear();

    // portalGroupId별로 분류
    const groups = new Map<number, TileModel[]>();
    for (const tile of this.tiles.values()) {
      if (tile.isPortal) {
        const gid = tile.portalGroupId;
        if (!groups.has(gid)) groups.set(gid, []);
        groups.get(gid)!.push(tile);
      }
    }

    for (const [, portals] of groups) {
      if (portals.length >= 2) {
        this.linkedPortals.set(portals[0], portals[1]);
        this.linkedPortals.set(portals[1], portals[0]);
      }
    }
  }

  getTile(x: number, y: number): TileModel | undefined {
    if (x < 0 || x >= this.size || y < 0 || y >= this.size) return undefined;
    return this.tiles.get(x + y * 100);
  }

  getReflectorType(x: number, y: number): ReflectorType {
    const r = this.reflectors.get(x + y * 100);
    // 타일 자체에 고정 반사판이 있으면 그것을 사용
    const tile = this.getTile(x, y);
    if (tile?.isFixedReflector || tile?.isTurnReflector) {
      return tile.tileData.reflectorType;
    }
    return r?.type ?? ReflectorType.None;
  }

  placeReflector(x: number, y: number, type: ReflectorType, playerId: number): boolean {
    const tile = this.getTile(x, y);
    if (!tile || !tile.isReflectorSetable) return false;

    const existing = this.reflectors.get(tile.index);
    if (existing && existing.playerId !== playerId) return false;  // 상대 반사판은 교체 불가

    this.reflectors.set(tile.index, { x, y, type, playerId });
    return true;
  }

  removeReflector(x: number, y: number): ReflectorPlacement | undefined {
    const index = x + y * 100;
    const r = this.reflectors.get(index);
    if (r) this.reflectors.delete(index);
    return r;
  }

  getStartTiles(): TileModel[] {
    return Array.from(this.tiles.values()).filter(t => t.isStartPosition);
  }

  getGoalTiles(): TileModel[] {
    return Array.from(this.tiles.values()).filter(t => t.isGoal);
  }
}

// 배틀용 기본 맵 생성 (11x11)
export function createBattleMap(tileRegistry: Map<number, TileData>): MapModel {
  const mapModel = new MapModel(tileRegistry);
  mapModel.load(createDefaultBattleMapData());
  return mapModel;
}

export function createDefaultBattleMapData(): MapData {
  const SIZE = 11;
  // TileRegistry의 TILE_INDEX와 일치:
  // 1 = Empty, 2 = Start(오른쪽발사=P1), 3 = Start(왼쪽발사=P2), 7 = Block
  // P1 스폰: x=0 열, → 오른쪽으로 발사 (uniqueIndex=2)
  // P2 스폰: x=10 열, → 왼쪽으로 발사 (uniqueIndex=3)
  const E = 1; // Empty (반사판 설치 가능)
  const L = 2; // Start Left-side (P1, 오른쪽으로 발사)
  const R = 3; // Start Right-side (P2, 왼쪽으로 발사)
  const B = 7; // Block
  const _ = 0; // 없음 (타일 없음)

  const tiles: number[][] = [
    // y=0
    [_, E, E, E, E, E, E, E, E, E, _],
    // y=1
    [E, E, E, E, E, E, E, E, E, E, E],
    // y=2  P1스폰                               P2스폰
    [L, E, E, E, B, E, B, E, E, E, R],
    // y=3
    [E, E, E, E, E, E, E, E, E, E, E],
    // y=4
    [E, E, E, E, E, E, E, E, E, E, E],
    // y=5 (중앙 장애물)
    [E, E, E, E, E, B, E, E, E, E, E],
    // y=6
    [E, E, E, E, E, E, E, E, E, E, E],
    // y=7
    [E, E, E, E, E, E, E, E, E, E, E],
    // y=8  P1스폰                               P2스폰
    [L, E, E, E, B, E, B, E, E, E, R],
    // y=9
    [E, E, E, E, E, E, E, E, E, E, E],
    // y=10
    [_, E, E, E, E, E, E, E, E, E, _],
  ];

  return { size: SIZE, tiles };
}
