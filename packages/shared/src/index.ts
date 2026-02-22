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
export type { BattleConfig, SpawnEvent, BattleResult, WallState, ItemCounts, WallEvent, TimeStopEvent, CoreEvent } from './core/BattleSimulator';

// Core - values
export { createTileData, EMPTY_TILE_INDEX } from './core/TileData';
export { TileModel } from './core/TileModel';
export { BallModel } from './core/BallModel';
export { MapModel, createBattleMap, createDefaultBattleMapData } from './core/MapModel';
export { BallSimulatorHistory } from './core/BallSimulatorHistory';
export { BallSimulationInstance } from './core/BallSimulationInstance';
export { BallSimulator } from './core/BallSimulator';
export { SpawnPointModel, CoreModel } from './core/SpawnPointModel';
export { BattleSimulator, DEFAULT_BATTLE_CONFIG } from './core/BattleSimulator';
export { createBattleTileRegistry, TILE_INDEX } from './core/TileRegistry';

// Types
export type {
  JoinQueueMsg, PlaceReflectorMsg, RemoveReflectorMsg,
  PlaceWallMsg, UseTimeStopMsg,
  SpawnPointInfo, CoreInfo, MatchFoundMsg, SpawnHpMsg, SpawnDestroyedMsg,
  ReflectorPlacedMsg, ReflectorRemovedMsg,
  BallSpawnedMsg, BallMovedMsg, BallEndedMsg, GameOverMsg,
  WallPlacedMsg, WallDamagedMsg, WallDestroyedMsg,
  TimeStopStartedMsg, TimeStopEndedMsg,
  CoreHpMsg, CoreDestroyedMsg,
} from './types/NetworkMessage';
export { SocketEvent } from './types/NetworkMessage';

export type {
  SpawnPointState, ReflectorState, BallState, GameState,
} from './types/GameState';
