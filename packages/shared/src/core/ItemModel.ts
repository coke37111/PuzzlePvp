export enum DropItemType {
  PowerUp        = 1, // 공격력 +1 (Orange 몬스터 드랍, 50%)
  BallCount      = 2, // 페이즈당 발사 공 수 +1 (White 몬스터 드랍, 30%)
  SpeedUp        = 3, // 공 이동 속도 증가 (LightBlue 몬스터 드랍, 19.9%)
  ReflectorExpand = 4, // 반사판 보드 최대 갯수 +1 (Purple 몬스터 드랍, 0.1%)
}

export class DroppedItemModel {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly itemType: DropItemType;
  pickedUp: boolean = false;

  constructor(id: number, x: number, y: number, itemType: DropItemType) {
    this.id = id;
    this.x = x;
    this.y = y;
    this.itemType = itemType;
  }
}
