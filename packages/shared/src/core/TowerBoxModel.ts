export const TOWER_BOX_HP_TABLE: Record<number, number> = {
  1: 1_000,
  2: 100_000,
  3: 1_000_000,
};

export class TowerBoxModel {
  readonly spawnPointId: number;
  readonly tier: number;   // 1, 2, 3
  hp: number;
  maxHp: number;
  broken: boolean = false;

  constructor(spawnPointId: number, tier: number) {
    this.spawnPointId = spawnPointId;
    this.tier = tier;
    this.hp = TOWER_BOX_HP_TABLE[tier] ?? 1_000;
    this.maxHp = this.hp;
  }

  /** 데미지 처리. 반환값 true = 파괴됨 */
  damage(amount: number): boolean {
    if (this.broken) return false;
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp === 0) {
      this.broken = true;
      return true;
    }
    return false;
  }
}
