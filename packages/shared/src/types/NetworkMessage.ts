import { ReflectorType } from '../enums/ReflectorType';
import { Direction } from '../enums/Direction';
import { MapData } from '../core/MapModel';
import { DropItemType } from '../core/ItemModel';
import { MonsterType } from '../core/MonsterModel';
import type { MapLayoutConfig, TeamConfig } from '../core/MapLayout';

// ─── 클라이언트 → 서버 ───────────────────────────────────────────

export interface JoinQueueMsg {
  // 빈 payload
}

export interface SetTargetPlayersMsg {
  targetCount: number;
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

export interface UseSwordMsg {
  x: number;
  y: number;
}

export interface UseShieldMsg {
  targetType: 'spawn' | 'core' | 'wall';
  targetId: string; // spawnId.toString(), coreId.toString(), or "x,y" for walls
}

// ─── 서버 → 클라이언트 ───────────────────────────────────────────

export interface SpawnPointInfo {
  id: number;
  x: number;
  y: number;
  ownerId: number;
  hp: number;
  maxHp: number;
  direction: number; // Direction enum 값 (Up=1,Down=2,Left=3,Right=4)
}

export interface CoreInfo {
  id: number;
  x: number;
  y: number;
  ownerId: number;
  hp: number;
  maxHp: number;
}

export interface MonsterInfo {
  id: number;
  monsterType: MonsterType;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
}

export interface MatchFoundMsg {
  roomId: string;
  playerId: number;
  mapData: MapData;
  spawnPoints: SpawnPointInfo[];
  cores: CoreInfo[];
  timePerPhase: number;
  spawnInterval: number;
  reflectorCooldown: number;
  maxReflectorStock: number;
  initialReflectorStock: number;
  monsters: MonsterInfo[];
  walls: WallPlacedMsg[];
  // N인 신규 필드 (없으면 레거시 1v1)
  playerCount?: number;
  teamId?: number;
  teams?: TeamConfig[];
  layout?: MapLayoutConfig;
  towerBoxes?: TowerBoxInfo[];
}

export interface MonsterSpawnedMsg {
  id: number;
  monsterType: MonsterType;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
}

export interface MonsterDamagedMsg {
  id: number;
  hp: number;
  maxHp: number;
}

export interface MonsterKilledMsg {
  id: number;
  x: number;
  y: number;
}

export interface MonsterMovedMsg {
  id: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

export interface ItemDroppedMsg {
  itemId: number;
  x: number;
  y: number;
  itemType: DropItemType;
}

export interface ItemPickedUpMsg {
  itemId: number;
  ballId: number;
  ballOwnerId: number;
}

export interface BallPoweredUpMsg {
  ballId: number;
  playerId: number;
}

export interface PlayerBallCountUpMsg {
  playerId: number;
  ballCountBonus: number; // 현재 보너스 총합
}

export interface PlayerSpeedUpMsg {
  playerId: number;
  speedBonus: number; // 현재 보너스 총합
}

export interface PlayerReflectorExpandMsg {
  playerId: number;
  reflectorBonus: number; // 현재 보너스 총합 (보드 최대치 +N)
}

export interface SpawnHealedMsg {
  spawnId: number;
  hp: number;
  maxHp: number;
  ownerId: number;
}

export interface CoreHealedMsg {
  coreId: number;
  hp: number;
  maxHp: number;
  ownerId: number;
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
  speedMultiplier: number;
}

export interface BallEndedMsg {
  ballId: number;
  x: number;
  y: number;
  reason: number;
  direction: number;  // 공이 마지막으로 이동하던 방향 (Direction enum)
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

export interface GoldUpdatedMsg {
  playerId: number;
  gold: number;
}

export interface SwordUsedMsg {
  attackerId: number;
  x: number;
  y: number;
}

export interface ShieldAppliedMsg {
  targetType: 'spawn' | 'core' | 'wall';
  targetId: string;
  duration: number;
  ownerId: number;
}

export interface ShieldExpiredMsg {
  targetType: 'spawn' | 'core' | 'wall';
  targetId: string;
}

export interface CoreHpMsg {
  coreId: number;
  hp: number;
  ownerId: number;
}

export interface CoreDestroyedMsg {
  coreId: number;
}

// ─── 타워 박스 ───────────────────────────────────────────────────

export interface TowerBoxInfo {
  spawnId: number;
  tier: number;
  hp: number;
  maxHp: number;
}

export interface TowerBoxDamagedMsg {
  spawnId: number;
  hp: number;
  maxHp: number;
}

export interface TowerBoxBrokenMsg {
  spawnId: number;
}

// ─── 소유권 이전 ─────────────────────────────────────────────────

export interface OwnershipTransferredMsg {
  oldOwnerId: number;
  newOwnerId: number;
  coreId: number;
  coreHp: number;
  coreMaxHp: number;
  spawnTransfers: {
    spawnId: number;
    hp: number;
    maxHp: number;
    active: boolean;
  }[];
}

// ─── 로비 ────────────────────────────────────────────────────────

export interface LobbyUpdateMsg {
  currentPlayers: number;
  maxPlayers: number;
  countdown: number;  // 남은 초, -1이면 카운트다운 미시작
}

// ─── 플레이어 탈락 ────────────────────────────────────────────────

export interface PlayerEliminatedMsg {
  playerId: number;
  teamId: number;
  remainingPlayers: number;
}

// ─── Socket.io 이벤트 이름 상수 ──────────────────────────────────

export const SocketEvent = {
  // C → S
  JOIN_QUEUE: 'join_queue',
  PLACE_REFLECTOR: 'place_reflector',
  REMOVE_REFLECTOR: 'remove_reflector',
  PLACE_WALL: 'place_wall',
  USE_SWORD: 'use_sword',
  USE_SHIELD: 'use_shield',
  LEAVE_QUEUE: 'leave_queue',
  SET_TARGET_PLAYERS: 'set_target_players',

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
  GOLD_UPDATED: 'gold_updated',
  SWORD_USED: 'sword_used',
  SHIELD_APPLIED: 'shield_applied',
  SHIELD_EXPIRED: 'shield_expired',
  CORE_HP: 'core_hp',
  CORE_DESTROYED: 'core_destroyed',
  MONSTER_SPAWNED: 'monster_spawned',
  MONSTER_DAMAGED: 'monster_damaged',
  MONSTER_KILLED: 'monster_killed',
  MONSTER_MOVED: 'monster_moved',
  ITEM_DROPPED: 'item_dropped',
  ITEM_PICKED_UP: 'item_picked_up',
  BALL_POWERED_UP: 'ball_powered_up',
  PLAYER_BALL_COUNT_UP: 'player_ball_count_up',
  PLAYER_SPEED_UP: 'player_speed_up',
  PLAYER_REFLECTOR_EXPAND: 'player_reflector_expand',
  SPAWN_HEALED: 'spawn_healed',
  CORE_HEALED: 'core_healed',
  LOBBY_UPDATE: 'lobby_update',
  PLAYER_ELIMINATED: 'player_eliminated',
  TOWER_BOX_DAMAGED: 'tower_box_damaged',
  TOWER_BOX_BROKEN: 'tower_box_broken',
  OWNERSHIP_TRANSFERRED: 'ownership_transferred',
} as const;
