import { BattleSimulator, ReflectorType } from '@puzzle-pvp/shared';
import type { PlayerZone } from '@puzzle-pvp/shared';

export class AIPlayer {
  readonly playerId: number;
  private simulator: BattleSimulator;
  private zone: PlayerZone;
  private decisionTimer: number = 0;
  private readonly DECISION_INTERVAL = 2.0; // 2초마다 한 번 결정

  constructor(playerId: number, simulator: BattleSimulator, zone: PlayerZone) {
    this.playerId = playerId;
    this.simulator = simulator;
    this.zone = zone;
  }

  update(delta: number): void {
    if (this.zone.eliminated) return;

    this.decisionTimer += delta;
    if (this.decisionTimer < this.DECISION_INTERVAL) return;
    this.decisionTimer = 0;

    this.makeDecision();
  }

  private makeDecision(): void {
    const stock = this.simulator.getReflectorStock(this.playerId);
    if (stock <= 0) return;

    // 존 내 반사판 설치 가능한 빈 타일 탐색
    const emptyTiles: { x: number; y: number }[] = [];
    for (let lx = 0; lx < this.zone.width; lx++) {
      for (let ly = 0; ly < this.zone.height; ly++) {
        const wx = this.zone.originX + lx;
        const wy = this.zone.originY + ly;
        if (this.simulator.canPlaceReflector(this.playerId, wx, wy)) {
          emptyTiles.push({ x: wx, y: wy });
        }
      }
    }
    if (emptyTiles.length === 0) return;

    const tile = emptyTiles[Math.floor(Math.random() * emptyTiles.length)];
    const type = Math.random() < 0.5 ? ReflectorType.Slash : ReflectorType.Backslash;
    this.simulator.placeReflector(this.playerId, tile.x, tile.y, type);
  }
}
