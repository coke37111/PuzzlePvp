import { TileModel } from './TileModel';
import { Direction } from '../enums/Direction';

export class SpawnPointModel {
  readonly id: number;
  readonly tile: TileModel;
  readonly ownerId: number;
  readonly spawnDirection: Direction;
  readonly maxHp: number;
  hp: number;
  active: boolean = true;

  constructor(id: number, tile: TileModel, ownerId: number, spawnDirection: Direction, maxHp: number = 5) {
    this.id = id;
    this.tile = tile;
    this.ownerId = ownerId;
    this.spawnDirection = spawnDirection;
    this.maxHp = maxHp;
    this.hp = maxHp;
  }

  /** 자기 공 도착 → HP 회복 (+1, maxHp 초과 불가) */
  heal(): void {
    if (!this.active) return;
    this.hp = Math.min(this.hp + 1, this.maxHp);
  }

  /** 적 공 도착 → HP 감소 (-1) */
  damage(): void {
    if (!this.active) return;
    this.hp = Math.max(this.hp - 1, 0);
    if (this.hp === 0) {
      this.active = false;
    }
  }
}
