import { TileModel } from './TileModel';

export class BallModel {
  id: number;
  placementTile: TileModel;
  /** 어느 플레이어 소속인지 (0 또는 1) */
  ownerId: number;

  constructor(id: number, placementTile: TileModel, ownerId: number = 0) {
    this.id = id;
    this.placementTile = placementTile;
    this.ownerId = ownerId;
  }
}
