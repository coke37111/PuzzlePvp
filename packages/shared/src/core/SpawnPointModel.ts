import { TileModel } from './TileModel';
import { Direction } from '../enums/Direction';

export class CoreModel {
  readonly id: number;
  readonly tile: TileModel;
  ownerId: number;
  maxHp: number;
  hp: number;
  active: boolean = true;

  constructor(id: number, tile: TileModel, ownerId: number, maxHp: number = 10) {
    this.id = id;
    this.tile = tile;
    this.ownerId = ownerId;
    this.maxHp = maxHp;
    this.hp = maxHp;
  }

  /** 아군 공 도착 → HP 회복 (amount만큼, maxHp 초과 시 maxHp도 증가) */
  heal(amount: number = 1): void {
    if (!this.active) return;
    this.hp += amount;
    if (this.hp > this.maxHp) {
      this.maxHp = this.hp;
    }
  }

  damage(amount: number = 1): void {
    if (!this.active) return;
    this.hp = Math.max(this.hp - amount, 0);
    if (this.hp === 0) {
      this.active = false;
    }
  }
}

export class SpawnPointModel {
  readonly id: number;
  readonly tile: TileModel;
  ownerId: number;
  readonly spawnDirection: Direction;
  maxHp: number;
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

  /** 아군 공 도착 → HP 회복 (amount만큼, maxHp 초과 시 maxHp도 증가) */
  heal(amount: number = 1): void {
    if (!this.active) return;
    this.hp += amount;
    if (this.hp > this.maxHp) {
      this.maxHp = this.hp;
    }
  }

  /** 적 공 도착 → HP 감소 */
  damage(amount: number = 1): void {
    if (!this.active) return;
    this.hp = Math.max(this.hp - amount, 0);
    if (this.hp === 0) {
      this.active = false;
    }
  }

  /** 리스폰: HP 초기화, active 복구 */
  respawn(hp: number): void {
    this.hp = hp;
    this.active = true;
  }
}
