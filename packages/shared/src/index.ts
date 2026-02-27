// Enums
export { Direction } from './enums/Direction';
export { TileType } from './enums/TileType';
export { ReflectorType } from './enums/ReflectorType';
export { EndReason } from './enums/EndReason';
export { ItemType } from './enums/ItemType';

// Core - types
export type { TileData } from './core/TileData';
export type { MapData, ReflectorPlacement } from './core/MapModel';
export type { SimulationSummary, BallArrivedAtTileCallback } from './core/BallSimulator';
export type { BattleConfig, SpawnEvent, BattleResult, WallState, WallEvent, CoreEvent } from './core/BattleSimulator';

// Core - values
export { createTileData, EMPTY_TILE_INDEX } from './core/TileData';
export { TileModel } from './core/TileModel';
export { BallModel } from './core/BallModel';
export { MonsterModel, MonsterType } from './core/MonsterModel';
export { DroppedItemModel, DropItemType } from './core/ItemModel';
export { MapModel, createBattleMap, createDefaultBattleMapData } from './core/MapModel';
export { BallSimulatorHistory } from './core/BallSimulatorHistory';
export { BallSimulationInstance } from './core/BallSimulationInstance';
export { BallSimulator } from './core/BallSimulator';
export { SpawnPointModel, CoreModel } from './core/SpawnPointModel';
export { BattleSimulator, DEFAULT_BATTLE_CONFIG } from './core/BattleSimulator';
export { createBattleTileRegistry, TILE_INDEX } from './core/TileRegistry';
export { TowerBoxModel, TOWER_BOX_HP_TABLE } from './core/TowerBoxModel';
export { generateNPlayerBattleMap, LAYOUT_TABLE, TOWER_BOX_HP } from './core/MapLayout';
export type {
  TeamConfig, PlayerZone, MapLayoutConfig,
  SpawnAssignment, CoreAssignment, ZoneWallSegment, GeneratedMap,
} from './core/MapLayout';

// Types
export type {
  JoinQueueMsg, PlaceReflectorMsg, RemoveReflectorMsg,
  PlaceWallMsg, UseSwordMsg, UseShieldMsg,
  SpawnPointInfo, CoreInfo, MonsterInfo, MatchFoundMsg, SpawnHpMsg, SpawnDestroyedMsg, SpawnRespawnedMsg,
  ReflectorPlacedMsg, ReflectorRemovedMsg,
  BallSpawnedMsg, BallMovedMsg, BallEndedMsg, GameOverMsg,
  WallPlacedMsg, WallDamagedMsg, WallDestroyedMsg,
  GoldUpdatedMsg, SwordUsedMsg, ShieldAppliedMsg, ShieldExpiredMsg,
  CoreHpMsg, CoreDestroyedMsg,
  SpawnPhaseCompleteMsg,
  ReflectorStockMsg,
  MonsterSpawnedMsg, MonsterDamagedMsg, MonsterKilledMsg, MonsterMovedMsg,
  ItemDroppedMsg, ItemPickedUpMsg, BallPoweredUpMsg,
  PlayerBallCountUpMsg, PlayerSpeedUpMsg, PlayerReflectorExpandMsg,
  SpawnHealedMsg, CoreHealedMsg,
  LobbyUpdateMsg, PlayerEliminatedMsg,
  TowerBoxInfo, TowerBoxDamagedMsg, TowerBoxBrokenMsg,
  SetTargetPlayersMsg, OwnershipTransferredMsg,
} from './types/NetworkMessage';
export { SocketEvent } from './types/NetworkMessage';

export type {
  SpawnPointState, ReflectorState, BallState, GameState,
} from './types/GameState';
