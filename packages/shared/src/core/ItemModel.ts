export enum DropItemType {
  PowerUp = 1,
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
