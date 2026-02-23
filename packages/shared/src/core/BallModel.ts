import { TileModel } from './TileModel';

export class BallModel {
  id: number;
  placementTile: TileModel;
  /** 어느 플레이어 소속인지 (0 또는 1) */
  ownerId: number;
  /** 공격력 (기본 1, 아이템 획득 시 최대 2) */
  power: number = 1;

  constructor(id: number, placementTile: TileModel, ownerId: number = 0) {
    this.id = id;
    this.placementTile = placementTile;
    this.ownerId = ownerId;
  }
}
