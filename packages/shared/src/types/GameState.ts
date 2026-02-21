import { ReflectorType } from '../enums/ReflectorType';

export interface SpawnPointState {
  id: number;
  x: number;
  y: number;
  ownerId: number;
  hp: number;
  maxHp: number;
  active: boolean;
}

export interface ReflectorState {
  x: number;
  y: number;
  type: ReflectorType;
  playerId: number;
}

export interface BallState {
  id: number;
  ownerId: number;
  x: number;
  y: number;
}

export interface GameState {
  tick: number;
  spawnPoints: SpawnPointState[];
  reflectors: ReflectorState[];
  balls: BallState[];
}
