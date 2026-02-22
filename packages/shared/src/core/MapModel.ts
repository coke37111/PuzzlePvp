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

  getCoreTiles(): TileModel[] {
    return Array.from(this.tiles.values()).filter(t => t.isCore);
  }
}

// 배틀용 기본 맵 생성 (7x7)
export function createBattleMap(tileRegistry: Map<number, TileData>): MapModel {
  const mapModel = new MapModel(tileRegistry);
  mapModel.load(createDefaultBattleMapData());
  return mapModel;
}

export function createDefaultBattleMapData(): MapData {
  const SIZE = 7;
  // TileRegistry의 TILE_INDEX와 일치:
  // 1=Empty, 2=StartRight(P1), 3=StartLeft(P2), 4=StartUp(P1), 5=StartDown(P2)
  // 6=CoreP1, 7=Block, 8=CoreP2
  // P1 스폰: (0,4) 위쪽 발사, (2,6) 오른쪽 발사
  // P2 스폰: (4,0) 왼쪽 발사, (6,2) 아래쪽 발사
  // P1 코어: (0,6), P2 코어: (6,0)
  const E  = 1; // Empty (반사판 설치 가능)
  const SR = 2; // Start Right (P1, 오른쪽 발사) - (2,6)
  const SL = 3; // Start Left  (P2, 왼쪽 발사)  - (4,0)
  const SU = 4; // Start Up    (P1, 위쪽 발사)   - (0,4)
  const SD = 5; // Start Down  (P2, 아래쪽 발사) - (6,2)
  const C1 = 6; // Core P1                       - (0,6)
  const C2 = 8; // Core P2                       - (6,0)

  const tiles: number[][] = [
    // y=0  x=0   x=1   x=2   x=3   x=4   x=5   x=6
    /*y=0*/ [E,    E,    E,    E,    SL,   E,    C2 ],
    /*y=1*/ [E,    E,    E,    E,    E,    E,    E  ],
    /*y=2*/ [E,    E,    E,    E,    E,    E,    SD ],
    /*y=3*/ [E,    E,    E,    E,    E,    E,    E  ],
    /*y=4*/ [SU,   E,    E,    E,    E,    E,    E  ],
    /*y=5*/ [E,    E,    E,    E,    E,    E,    E  ],
    /*y=6*/ [C1,   E,    SR,   E,    E,    E,    E  ],
  ];

  return { size: SIZE, tiles };
}
