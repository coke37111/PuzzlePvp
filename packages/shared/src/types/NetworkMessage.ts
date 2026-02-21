import { ReflectorType } from '../enums/ReflectorType';
import { Direction } from '../enums/Direction';
import { MapData } from '../core/MapModel';

// ─── 클라이언트 → 서버 ───────────────────────────────────────────

export interface JoinQueueMsg {
  // 빈 payload
}

export interface PlaceReflectorMsg {
  x: number;
  y: number;
  type: ReflectorType;
}

export interface RemoveReflectorMsg {
  x: number;
  y: number;
}

// ─── 서버 → 클라이언트 ───────────────────────────────────────────

export interface SpawnPointInfo {
  id: number;
  x: number;
  y: number;
  ownerId: number;
  hp: number;
  maxHp: number;
}

export interface MatchFoundMsg {
  roomId: string;
  playerId: number;  // 0 또는 1
  mapData: MapData;
  spawnPoints: SpawnPointInfo[];
  timePerPhase: number;  // 공 이동 1칸 소요시간 (초)
}

export interface SpawnHpMsg {
  spawnId: number;
  hp: number;
  ownerId: number;
}

export interface SpawnDestroyedMsg {
  spawnId: number;
}

export interface ReflectorPlacedMsg {
  playerId: number;
  x: number;
  y: number;
  type: ReflectorType;
}

export interface ReflectorRemovedMsg {
  playerId: number;
  x: number;
  y: number;
}

export interface BallSpawnedMsg {
  ballId: number;
  ownerId: number;
  x: number;
  y: number;
  direction: Direction;
}

export interface BallMovedMsg {
  ballId: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

export interface BallEndedMsg {
  ballId: number;
  x: number;
  y: number;
  reason: number;
}

export interface GameOverMsg {
  winnerId: number;  // 0 또는 1, -1이면 무승부
}

// ─── Socket.io 이벤트 이름 상수 ──────────────────────────────────

export const SocketEvent = {
  // C → S
  JOIN_QUEUE: 'join_queue',
  PLACE_REFLECTOR: 'place_reflector',
  REMOVE_REFLECTOR: 'remove_reflector',

  // S → C
  MATCH_FOUND: 'match_found',
  SPAWN_HP: 'spawn_hp',
  SPAWN_DESTROYED: 'spawn_destroyed',
  REFLECTOR_PLACED: 'reflector_placed',
  REFLECTOR_REMOVED: 'reflector_removed',
  BALL_SPAWNED: 'ball_spawned',
  BALL_MOVED: 'ball_moved',
  BALL_ENDED: 'ball_ended',
  GAME_OVER: 'game_over',
} as const;
