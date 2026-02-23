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

export interface PlaceWallMsg {
  x: number;
  y: number;
}

export interface UseTimeStopMsg {
  // 빈 payload
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

export interface CoreInfo {
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
  cores: CoreInfo[];
  timePerPhase: number;       // 공 이동 1칸 소요시간 (초)
  spawnInterval: number;      // 공 자동 발사 주기 (초)
  reflectorCooldown: number;      // 반사판 1개 재생성 시간 (초)
  maxReflectorStock: number;      // 반사판 최대 보유 수
  initialReflectorStock: number;  // 게임 시작 초기 보유 수
}

export interface SpawnHpMsg {
  spawnId: number;
  hp: number;
  ownerId: number;
}

export interface SpawnDestroyedMsg {
  spawnId: number;
  respawnDuration: number; // 리스폰까지 걸리는 초 (20, 25, 30, ...)
}

export interface SpawnRespawnedMsg {
  spawnId: number;
  hp: number;
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
  phaseNumber: number;
}

export interface SpawnPhaseCompleteMsg {
  phaseNumber: number;
}

export interface ReflectorStockMsg {
  playerId: number;
  stock: number;
  cooldownElapsed: number; // 현재 쿨다운 경과 시간 (초)
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

export interface WallPlacedMsg {
  playerId: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
}

export interface WallDamagedMsg {
  x: number;
  y: number;
  hp: number;
}

export interface WallDestroyedMsg {
  x: number;
  y: number;
}

export interface TimeStopStartedMsg {
  playerId: number;
  duration: number;
}

export interface TimeStopEndedMsg {
  // 빈 payload
}

export interface CoreHpMsg {
  coreId: number;
  hp: number;
  ownerId: number;
}

export interface CoreDestroyedMsg {
  coreId: number;
}

// ─── Socket.io 이벤트 이름 상수 ──────────────────────────────────

export const SocketEvent = {
  // C → S
  JOIN_QUEUE: 'join_queue',
  PLACE_REFLECTOR: 'place_reflector',
  REMOVE_REFLECTOR: 'remove_reflector',
  PLACE_WALL: 'place_wall',
  USE_TIME_STOP: 'use_time_stop',

  // S → C
  MATCH_FOUND: 'match_found',
  SPAWN_HP: 'spawn_hp',
  SPAWN_DESTROYED: 'spawn_destroyed',
  SPAWN_RESPAWNED: 'spawn_respawned',
  REFLECTOR_PLACED: 'reflector_placed',
  REFLECTOR_REMOVED: 'reflector_removed',
  BALL_SPAWNED: 'ball_spawned',
  SPAWN_PHASE_COMPLETE: 'spawn_phase_complete',
  REFLECTOR_STOCK: 'reflector_stock',
  BALL_MOVED: 'ball_moved',
  BALL_ENDED: 'ball_ended',
  GAME_OVER: 'game_over',
  WALL_PLACED: 'wall_placed',
  WALL_DAMAGED: 'wall_damaged',
  WALL_DESTROYED: 'wall_destroyed',
  TIME_STOP_STARTED: 'time_stop_started',
  TIME_STOP_ENDED: 'time_stop_ended',
  CORE_HP: 'core_hp',
  CORE_DESTROYED: 'core_destroyed',
} as const;
