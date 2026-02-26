import { Direction } from '../enums/Direction';

// ========== 레이아웃 테이블 (인원수 → [열 수, 행 수]) ==========
export const LAYOUT_TABLE: Record<number, [number, number]> = {
  2:  [2, 1],   // 2열 1행
  4:  [2, 2],   // 2열 2행
  6:  [2, 3],   // 2열 3행
  8:  [4, 2],   // 4열 2행
  10: [2, 5],   // 2열 5행
  12: [4, 3],   // 4열 3행
  14: [2, 7],   // 2열 7행
  16: [4, 4],   // 4열 4행
};

// ========== 타일 인덱스 상수 ==========
const TILE_EMPTY   = 1; // TILE_INDEX.EMPTY
const TILE_START   = 2; // TILE_INDEX.START_RIGHT (N인은 방향을 spawnAssignments로 결정)
const TILE_CORE    = 6; // TILE_INDEX.CORE_P1

// ========== 팀 설정 ==========
export interface TeamConfig {
  teamId: number;
  playerIds: number[];
}

// ========== 플레이어 존 ==========
export interface PlayerZone {
  playerId: number;
  teamId: number;
  zoneCol: number;    // 존 그리드 내 열 (0-indexed)
  zoneRow: number;    // 존 그리드 내 행 (0-indexed)
  originX: number;    // 월드 타일 좌표 기준 존 좌상단 X
  originY: number;    // 월드 타일 좌표 기준 존 좌상단 Y
  width: number;      // 항상 9
  height: number;     // 항상 9
  eliminated: boolean;
  isAI: boolean;
}

// ========== 맵 레이아웃 전체 설정 ==========
export interface MapLayoutConfig {
  playerCount: number;
  zoneCols: number;
  zoneRows: number;
  zoneSize: number;       // 11 (고정)
  wallThickness: number;  // 1 (고정)
  totalWidth: number;
  totalHeight: number;
  zones: PlayerZone[];
  teams: TeamConfig[];
}

// ========== 스폰 배정 ==========
export interface SpawnAssignment {
  x: number;
  y: number;
  ownerId: number;
  direction: Direction;
  locked: boolean;
  boxTier: number;  // 0 = 활성, 1 = 1K HP, 2 = 100K HP, 3 = 1M HP
}

// ========== 코어 배정 ==========
export interface CoreAssignment {
  x: number;
  y: number;
  ownerId: number;
}

// ========== 존 경계 벽 정보 ==========
export interface ZoneWallSegment {
  x: number;
  y: number;
  hp: number;
}

// ========== 맵 생성 결과 ==========
export interface GeneratedMap {
  mapData: {
    width: number;
    height: number;
    tiles: number[][];
  };
  layout: MapLayoutConfig;
  spawnAssignments: SpawnAssignment[];
  coreAssignments: CoreAssignment[];
  zoneWalls: ZoneWallSegment[];
}

// ========== 타워 박스 HP 상수 ==========
export const TOWER_BOX_HP: Record<number, number> = {
  1: 1_000,
  2: 100_000,
  3: 1_000_000,
};

// ========== 존 경계 벽 HP 계산 (중앙 100, 가장자리 10M 계단식) ==========
function calcZoneWallHp(pos: number, totalLen: number): number {
  const center = (totalLen - 1) / 2;
  const dist = Math.abs(pos - center);
  const t = totalLen > 1 ? dist / center : 0;
  const level = Math.min(5, Math.round(t * 5));
  return Math.pow(10, 2 + level);  // 100, 1K, 10K, 100K, 1M, 10M
}

// ========== 배열 셔플 유틸 ==========
function shuffleArray<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/**
 * N인 배틀 맵 생성
 * - 각 플레이어는 9×9 개인 존
 * - 존 사이 1타일 두께의 파괴 가능한 벽
 * - 각 존 중앙(4,4)에 코어, 코어 대각선 2칸에 4개 타워 (1개 활성, 3개 잠금)
 * - 팀은 좌우로 분리 (왼쪽 열 = 팀0, 오른쪽 열 = 팀1)
 */
export function generateNPlayerBattleMap(playerCount: number): GeneratedMap {
  const [cols, rows] = LAYOUT_TABLE[playerCount] ?? [2, 1];
  const zoneSize = 9;
  const wallThick = 1;

  const totalW = cols * zoneSize + (cols - 1) * wallThick;
  const totalH = rows * zoneSize + (rows - 1) * wallThick;

  // 전체 맵을 0(타일 없음)으로 초기화
  const tiles: number[][] = Array.from({ length: totalH }, () => Array(totalW).fill(0));

  const zones: PlayerZone[] = [];
  const spawnAssignments: SpawnAssignment[] = [];
  const coreAssignments: CoreAssignment[] = [];
  const zoneWalls: ZoneWallSegment[] = [];

  // 팀 배정 (좌우 분리)
  const halfCols = Math.ceil(cols / 2);  // 왼쪽 팀 열 수
  const teams: TeamConfig[] = [
    { teamId: 0, playerIds: [] },
    { teamId: 1, playerIds: [] },
  ];

  // 타워 위치 정의 (존 로컬 좌표, 코어 (4,4) 기준 대각선 2칸)
  const towerDefs = [
    { lx: 3, ly: 2, dir: Direction.Up },     // 좌상 → 위로 발사
    { lx: 5, ly: 2, dir: Direction.Right },  // 우상 → 오른쪽으로 발사
    { lx: 5, ly: 6, dir: Direction.Down },   // 우하 → 아래로 발사
    { lx: 3, ly: 6, dir: Direction.Left },   // 좌하 → 왼쪽으로 발사
  ];

  let playerIdx = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (playerIdx >= playerCount) break;

      const originX = col * (zoneSize + wallThick);
      const originY = row * (zoneSize + wallThick);
      const teamId = col < halfCols ? 0 : 1;

      // 존 영역을 EMPTY로 채움
      for (let ly = 0; ly < zoneSize; ly++) {
        for (let lx = 0; lx < zoneSize; lx++) {
          tiles[originY + ly][originX + lx] = TILE_EMPTY;
        }
      }

      // 코어 배치 (존 중앙 4,4)
      const coreX = originX + 4;
      const coreY = originY + 4;
      tiles[coreY][coreX] = TILE_CORE;
      coreAssignments.push({ x: coreX, y: coreY, ownerId: playerIdx });

      // 4개 타워 배치 (1개 랜덤 활성, 나머지 3개 잠금)
      const activeIdx = Math.floor(Math.random() * 4);
      const lockedTiers = [1, 2, 3];
      shuffleArray(lockedTiers);
      let lockedCounter = 0;

      for (let i = 0; i < towerDefs.length; i++) {
        const td = towerDefs[i];
        const wx = originX + td.lx;
        const wy = originY + td.ly;
        tiles[wy][wx] = TILE_START;

        const isLocked = i !== activeIdx;
        const boxTier = isLocked ? lockedTiers[lockedCounter++] : 0;

        spawnAssignments.push({
          x: wx, y: wy,
          ownerId: playerIdx,
          direction: td.dir,
          locked: isLocked,
          boxTier,
        });
      }

      // 팀 배정
      teams[teamId].playerIds.push(playerIdx);

      zones.push({
        playerId: playerIdx,
        teamId,
        zoneCol: col,
        zoneRow: row,
        originX, originY,
        width: zoneSize, height: zoneSize,
        eliminated: false,
        isAI: false,
      });

      playerIdx++;
    }
  }

  // 존 사이 수직 격벽 (열 사이) — 구역 단위로 HP 패턴 반복
  for (let col = 0; col < cols - 1; col++) {
    const wx = col * (zoneSize + wallThick) + zoneSize;
    for (let y = 0; y < totalH; y++) {
      tiles[y][wx] = TILE_EMPTY;
      const segIdx = Math.floor(y / (zoneSize + wallThick));
      const localY = y - segIdx * (zoneSize + wallThick);
      const hp = localY < zoneSize
        ? calcZoneWallHp(localY, zoneSize)
        : calcZoneWallHp(0, zoneSize);  // 교차점: 최대 HP
      zoneWalls.push({ x: wx, y, hp });
    }
  }

  // 존 사이 수평 격벽 (행 사이) — 구역 단위로 HP 패턴 반복
  for (let row = 0; row < rows - 1; row++) {
    const wy = row * (zoneSize + wallThick) + zoneSize;
    for (let x = 0; x < totalW; x++) {
      if (tiles[wy][x] === 0) {
        tiles[wy][x] = TILE_EMPTY;
      }
      if (!zoneWalls.some(w => w.x === x && w.y === wy)) {
        const segIdx = Math.floor(x / (zoneSize + wallThick));
        const localX = x - segIdx * (zoneSize + wallThick);
        const hp = localX < zoneSize
          ? calcZoneWallHp(localX, zoneSize)
          : calcZoneWallHp(0, zoneSize);  // 교차점: 최대 HP
        zoneWalls.push({ x, y: wy, hp });
      }
    }
  }

  return {
    mapData: { width: totalW, height: totalH, tiles },
    layout: {
      playerCount,
      zoneCols: cols,
      zoneRows: rows,
      zoneSize,
      wallThickness: wallThick,
      totalWidth: totalW,
      totalHeight: totalH,
      zones,
      teams,
    },
    spawnAssignments,
    coreAssignments,
    zoneWalls,
  };
}
