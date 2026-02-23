export class MonsterModel {
  readonly id: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  active: boolean = true;

  constructor(id: number, x: number, y: number, hp: number) {
    this.id = id;
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
