export enum MonsterType {
  Orange   = 0, // 공격력 증가 아이템 드랍 (50%)
  White    = 1, // 공 갯수 추가 아이템 드랍 (30%)
  LightBlue = 2, // 공 속도 증가 아이템 드랍 (19.9%)
  Purple   = 3, // 반사판 갯수 확장 아이템 드랍 (0.1%)
}

export class MonsterModel {
  readonly id: number;
  readonly type: MonsterType;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  active: boolean = true;

  constructor(id: number, type: MonsterType, x: number, y: number, hp: number) {
    this.id = id;
    this.type = type;
    this.x = x;
    this.y = y;
    this.hp = hp;
    this.maxHp = hp;
  }

  damage(amount: number = 1): void {
    if (!this.active) return;
    this.hp = Math.max(this.hp - amount, 0);
    if (this.hp === 0) {
      this.active = false;
    }
  }
}
