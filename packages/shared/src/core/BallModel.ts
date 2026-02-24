import { TileModel } from './TileModel';

export class BallModel {
  id: number;
  placementTile: TileModel;
  /** 어느 플레이어 소속인지 (0 또는 1) */
  ownerId: number;
  /** 공격력 (기본 1, PowerUp 아이템 획득 시 증가) */
  power: number = 1;
  /** 이동 속도 배율 (기본 1.0, SpeedUp 아이템 획득 시 증가) */
  speedMultiplier: number = 1.0;

  constructor(id: number, placementTile: TileModel, ownerId: number = 0) {
    this.id = id;
    this.placementTile = placementTile;
    this.ownerId = ownerId;
  }
}
